# Fourier Multiplexed Scan Plan (FFT/OFDM-style)

Date: 2026-02-13  
Project: Echoscope (`src/scan`, `src/signal`, `src/dsp`, `src/ui`)

## 1) Цель и ожидаемый эффект

Ускорить полный азимутальный скан за счёт частотного мультиплексирования (несколько ортогональных поднесущих в одном пинге) при сохранении или улучшении стабильности обнаружения.

Целевые KPI для первой итерации:
- Сократить время sweep на **30–55%** при том же угловом разрешении.
- Удержать деградацию по дальности не хуже **±10%** от baseline (chirp/golay).
- Удержать рост false positives не выше **+10%** относительно baseline после фильтрации confidence/CFAR.
- Не допустить роста CPU времени на цикл более **+25%** на целевых устройствах.

## 2) Техническая идея

Вместо последовательной отправки нескольких зондов:
1. Формируем один составной TX-сигнал из K ортогональных поднесущих (FDM/OFDM-style).
2. В приёме делаем FFT-демультиплексирование по тем же поднесущим.
3. По каждой поднесущей восстанавливаем вклад (комплексная корреляция/energy profile).
4. Сливаем поднесущие в итоговый профиль диапазона с весами по SNR/PSR.
5. Во время калибровки автоматически определяем лучшие несущие для устройства/сцены и используем только их в скане.

Это даёт параллельность в частотной области и снижает число отдельных пингов на угол.

## 3) Ограничения и допущения

- Частотный диапазон ограничен текущим `MIN_FREQUENCY..MAX_FREQUENCY` (`800..12000 Hz`).
- `sampleRate` по умолчанию ~48 kHz.
- В комнате возможны сильные мультипути и узкие резонансы, поэтому требуется адаптивный weighting per-subcarrier.
- На первом этапе используем моно TX и существующий RX beamforming (`delayAndSum`) без изменений геометрии.

## 4) Предлагаемая схема сигнала (MVP)

### 4.1 Режим

Режим: `probe.type = 'multiplex'` (новый тип), внутри которого:
- `carrierCount`: 4..8 (MVP: 6)
- `fStart`, `fEnd`: рабочая полоса (например 2.2–8.8 kHz)
- `toneSpacingHz`: ортогональный шаг (`~1/Tsymbol`)
- `symbolMs`: 6..10 ms
- `window`: Hann (как в chirp)

### 4.2 Ортогональность

Ортогональность обеспечивается:
- целочисленным числом периодов в окне символа,
- согласованным шагом частот,
- одинаковым окном и длиной для TX/RX reference kernels.

### 4.3 Мощность

Вводим нормировку амплитуд по поднесущим:
- flat по умолчанию,
- optional pre-emphasis по данным калибровки (компенсация АЧХ устройства).

### 4.4 Определение лучших несущих во время калибровки

Добавляем калибровочный шаг `carrier qualification`:
- формируем расширенный набор кандидатов (например 10–14 частот в рабочей полосе);
- выполняем короткую серию пингов на кандидате частот (2–4 повтора);
- считаем метрики на каждой несущей: `SNR`, `PSR`, стабильность `tau0`, доля CFAR detection, устойчивость по повторениям;
- отбрасываем несущие с низкой стабильностью/перегрузкой/утечкой;
- выбираем Top-K несущих и сохраняем `activeCarrierHz[]` + `carrierWeights[]` в калибровочный результат.

Минимальная формула ранжирования (MVP):
- `score = 0.40*SNRn + 0.30*PSRn + 0.20*Stabilityn + 0.10*DetectRaten`
- выбрать `K` лучших с ограничением минимального частотного разнесения (`minSpacingHz`).

## 5) Изменения по модулям

## 5.1 `src/types.ts`

Добавить типы:
- `MultiplexConfig`
- расширение `ProbeType` и `ProbeConfig` для `'multiplex'`
- `SubcarrierStat` и `MultiplexDebugInfo` для диагностики качества
- `CarrierCalibrationResult` для хранения качества кандидатов и выбранной маски

Пример полей `MultiplexConfig`:
- `carrierCount: number`
- `fStart: number`
- `fEnd: number`
- `symbolMs: number`
- `guardHz: number`
- `fusion: 'snrWeighted' | 'median' | 'trimmedMean'`
- `coherentAcrossPings: boolean`

## 5.2 `src/signal/` (новое)

Добавить файл `src/signal/multiplex.ts`:
- генерация комплексно-эквивалентного набора поднесущих (реальный TX waveform)
- возврат reference bank для приёмной обработки (по каждой поднесущей)
- нормировка энергии под total `gain`

Обновить `src/signal/probe-factory.ts`:
- поддержка `type: 'multiplex'`
- возврат структуры вида `{ ref: Float32Array, refsByCarrier: Float32Array[] }`

## 5.3 `src/dsp/` (новое)

Добавить `src/dsp/multiplex-demux.ts`:
- FFT-demux по carrier bins
- оценка per-carrier SNR/PSR
- построение per-carrier range profile
- fusion в общий профиль

Можно переиспользовать:
- `fftCorrelateComplex` из `src/dsp/fft-correlate.ts`
- `computeProfileConfidence` из `src/scan/confidence.ts`

## 5.4 `src/scan/ping-cycle.ts`

В `doPingDetailed()` добавить ветку:
- если `probe.type === 'multiplex'`: 
  - один вызов `pingAndCaptureSteered(...)`
  - `delayAndSum(...)` (если активен RX array)
  - демультиплексирование + fusion
  - дальше текущий pipeline: env baseline → clutter → quality → CFAR/confidence gate

Важно: не ломать существующие ветки chirp/mls/golay.

## 5.5 `src/core/store.ts` и `src/ui/controls.ts`

Добавить конфиги/контролы:
- режим `multiplex`
- `carrierCount`, `fStart`, `fEnd`, `symbolMs`
- стратегия fusion
- чекбокс fallback на chirp при низком confidence

UI-режим сделать минимальным (без новых панелей):
- использовать уже существующую механику `syncModeUI()` с новым box.

## 5.6 `src/calibration/engine.ts` (+ при необходимости `src/calibration/band-runner.ts`)

Добавить шаг в основной calibration pipeline:
- `qualifyMultiplexCarriers(...)` после базовой оценки задержки/качества;
- сформировать `activeCarrierHz[]`, `carrierWeights[]`, `minSpacingHz`;
- положить результат в `calibration` state, чтобы scan использовал уже отобранные несущие.

Выход калибровки:
- список кандидатов с метриками;
- выбранный поднабор для сканирования;
- причина исключения плохих несущих (низкий SNR, нестабильный tau0, сильная утечка).

## 5.7 `src/scan/scan-engine.ts`

Без радикальной логики:
- переиспользовать текущую multi-pass агрегацию (`scanAggregateMode`) поверх уже fused multiplex-profile.
- добавить telemetry по времени на угол/сweep для сравнения с baseline.

## 6) План этапов внедрения

## Phase A — Simulation + API каркас (1–2 дня)

Задачи:
- Добавить типы и конфиг в `types.ts`.
- Реализовать генератор multiplex waveforms (`signal/multiplex.ts`).
- Добавить feature-flag `enableMultiplex` (по умолчанию off).
- Добавить структуры состояния для `activeCarrierHz[]`/`carrierWeights[]`.

Критерий готовности:
- Юнит-тесты на генератор проходят.
- Текущие режимы chirp/mls/golay без регрессий.

## Phase B — Калибровочный выбор несущих (1–2 дня)

Задачи:
- Реализовать `qualifyMultiplexCarriers` в `calibration` pipeline.
- Ввести ранжирование и отбор Top-K с `minSpacingHz`.
- Добавить fallback: если кандидатов мало, использовать безопасный preset набор.

Критерий готовности:
- Калибровка стабильно возвращает непустой набор активных несущих.
- Результаты повторяемы (при одинаковой сцене маска близка по составу).

## Phase C — RX демультиплекс и fusion (2–3 дня)

Задачи:
- Реализовать `dsp/multiplex-demux.ts`.
- Добавить SNR/PSR оценки по поднесущим.
- Реализовать 2 стратегии fusion: `snrWeighted` и `trimmedMean`.

Критерий готовности:
- На синтетике корректно разделяются carriers при известном канале.
- Нет значимой утечки между соседними поднесущими при корректном spacing.

## Phase D — Интеграция в scan pipeline (1–2 дня)

Задачи:
- Ветка в `doPingDetailed()` для multiplex.
- Подключение в UI/select режима.
- Debug readouts: confidence per-carrier, active-carrier count.

Критерий готовности:
- Запуск scan в браузере стабилен.
- Heatmap обновляется без NaN/zero-collapse.

## Phase E — Тюнинг и fallback политика (2 дня)

Задачи:
- Адаптивное отключение «плохих» carrier (низкий confidence).
- Политика fallback на chirp/golay при плохом median confidence N sweep подряд.
- Тюнинг `carrierCount`, `symbolMs`, `guardHz` для laptop presets.

Критерий готовности:
- В реальных помещениях (2–3 сцены) ускорение sweep подтверждено.
- Качество не хуже целевых KPI.

## Phase F — Rollout (1 день)

Задачи:
- Включить feature-flag для внутреннего режима.
- Добавить документацию по параметрам и safe defaults.
- Подготовить A/B сценарий сравнения baseline vs multiplex.

Критерий готовности:
- Решение готово к controlled rollout.

## 7) Параметры для первого эксперимента (рекомендуемые)

- `carrierCount = 6`
- `fStart = 2200 Hz`, `fEnd = 8800 Hz`
- `symbolMs = 8 ms`
- `guardHz = 180 Hz`
- `fusion = 'snrWeighted'`
- `calibrationCandidates = 12`, `selectedCarriers = 6`
- `minSpacingHz = 220`
- `scanPasses = 1` (для оценки чистого speedup)
- `scanAggregateMode = 'trimmedMean'` (оставить как есть)

Почему так:
- Полоса остаётся в наиболее «рабочем» участке ноутбучных динамиков.
- 6 carriers — компромисс между параллелизмом и межтональной утечкой.

## 8) Риски и анти-риск меры

1. **Inter-carrier leakage** при коротком окне/плохой калибровке частот.
   - Меры: guardHz, строгая длина символа, оконная функция, исключение слабых carriers.

2. **Нелинейности динамика** (IMD) при высокой суммарной амплитуде.
   - Меры: crest-factor контроль, -3..-6 dB headroom, ограничение числа carriers.

3. **Device variability** между ноутбуками/телефонами.
   - Меры: auto-band mask + preset-based defaults.

4. **CPU overhead** от дополнительной FFT/демультиплекса.
   - Меры: reuse буферов, предрасчёт kernels, batched FFT.

5. **Дрифт сцены после калибровки** (перемещение устройства/изменение шума).
  - Меры: периодическая переквалификация несущих (например раз в N минут или при падении confidence).

## 9) Тест-план

Новые тесты:
- `tests/signal/multiplex.test.ts`
  - правильная длина, энергия, частотные пики carrier bank.

- `tests/dsp/multiplex-demux.test.ts`
  - демультиплекс точных тонов с контролируемым SNR.
  - устойчивость при частичном отключении carriers.

- `tests/calibration/multiplex-carrier-selection.test.ts`
  - корректный Top-K отбор по score.
  - соблюдение `minSpacingHz`.
  - fallback на preset при деградации кандидатов.

- `tests/scan/multiplex-ping-cycle.test.ts`
  - корректный проход через `doPingDetailed` + gating.

- `tests/scan/multiplex-vs-baseline-regression.test.ts`
  - проверка, что baseline режимы не деградируют.

Метрики в CI/локально:
- median sweep time
- detection стабильность (variance угла/дальности)
- confidence distribution

## 10) Определение готовности (DoD)

Фича считается готовой, когда:
1. Реализованы Phases A–F.
2. Все новые тесты и существующие scan/dsp регрессии проходят.
3. На реальных сценах подтверждён speedup минимум 30%.
4. По качеству detection соблюдены KPI из раздела 1.
5. Есть безопасный fallback на baseline режим и feature-flag control.
6. Калибровка выбирает устойчивый набор несущих и этот набор реально применяется в scan.

---

## Quick Start Checklist (что делать прямо сейчас)

1. Добавить `multiplex` в `ProbeType/ProbeConfig` (`src/types.ts`).
2. Создать `src/signal/multiplex.ts` + тест генератора.
3. Создать `src/dsp/multiplex-demux.ts` + тест демультиплекса.
4. Добавить `qualifyMultiplexCarriers` в `src/calibration/engine.ts` + тесты отбора.
5. Включить ветку в `src/scan/ping-cycle.ts` за флагом и чтением `activeCarrierHz[]`.
6. Добавить минимум UI controls в `src/ui/controls.ts`.
7. Прогнать A/B: baseline chirp vs multiplex на одинаковых сценах.