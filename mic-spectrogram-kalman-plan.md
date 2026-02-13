# План добавления спектрограммы микрофона и Kalman-фильтра шума

Date: 2026-02-13  
Project: Echoscope (`src/audio`, `src/viz`, `src/calibration`, `src/scan`, `src/dsp`, `src/ui`)

## 1) Цель

Добавить:
1. **Онлайн-спектрограмму микрофона** (реальный входной сигнал до/после обработки).
2. **Kalman-фильтр для оценки и подавления постоянного фонового шума**:
   - во время **калибровки** (построение более устойчивого baseline),
   - во время **сканирования** (стабилизация noise floor без «съедания» целей).

Ожидаемый эффект:
- лучше видимость спектральной обстановки в комнате;
- меньше ложных срабатываний от стационарного шума;
- выше повторяемость калибровки и стабильность скана.

## 2) Текущее состояние (по коду)

Уже есть в проекте:
- Поток микрофонных сэмплов через событие `audio:samples` в `src/audio/engine.ts`.
- Мини-визуализация уровня (`src/viz/level-meter.ts`) на том же источнике данных.
- Подавление окружения и клаттера:
  - `applyEnvBaseline(...)` в `src/dsp/clutter.ts`,
  - `suppressStaticReflections(...)` в `src/dsp/clutter.ts`,
  - baseline из калибровки в `src/calibration/env-baseline.ts` и `src/calibration/engine.ts`.
- Пайплайн сканирования: `src/scan/ping-cycle.ts` (+ quality/confidence/CFAR).
- Реализация Kalman для трекинга целей (`src/tracking/kalman.ts`) — можно частично переиспользовать математику/паттерн конфигурации.

## 3) Scope (MVP)

### In scope
1. Новый модуль спектрограммы микрофона (STFT + отрисовка на canvas).
2. Новая модель шумового фона на основе Kalman-подобной рекурсии по bins (1D per-bin state).
3. Интеграция noise-floor фильтра:
   - в калибровочный baseline,
   - в scan pipeline перед confidence/CFAR.
4. Конфиг/контролы для включения, скорости адаптации и ограничений.
5. Тесты DSP-логики шумового фильтра.

### Out of scope (для следующей итерации)
- GPU/WebGL спектрограмма.
- Полный 2D/3D Kalman по времени+частоте.
- Авто-подбор параметров фильтра ML-моделью.

## 4) Архитектура решения

## 4.1 Спектрограмма микрофона

Источник данных:
- использовать существующий `bus.on('audio:samples', ...)`.

Новый модуль:
- `src/viz/mic-spectrogram.ts`:
  - кольцевой буфер окон STFT,
  - FFT окна (переиспользовать `src/dsp/fft.ts` при достаточной производительности),
  - перевод в dB,
  - прокрутка «водопада» по времени.

Интеграция UI:
- добавить canvas в `index.html` (рядом с level meter / debug-визуализациями);
- инициализация в `src/ui/app.ts` рядом с `initLevelMeter()`.

MVP-параметры:
- `fftSize = 512` (или 1024),
- `hop = fftSize / 4`,
- окно Hann,
- диапазон отображения: `[-90 dB, -20 dB]`,
- FPS рендера ограничить (например 20–30) через `requestAnimationFrame` + дропаут кадров.

## 4.2 Kalman noise-floor (постоянный фон)

Идея:
- оценивать медленно меняющийся фоновый уровень `noiseFloor[k]` отдельно для каждого bin.
- обновлять оценку только в «нецелевых» областях или с ослаблением при высокой novelty/confidence.

Новый DSP-модуль:
- `src/dsp/noise-floor-kalman.ts`
  - `NoiseKalmanState`:
    - `x: Float32Array` (оценка noise floor),
    - `p: Float32Array` (дисперсия оценки),
    - размеры = число bins.
  - `predict(state, q)`
  - `update(state, measurement, r, gainClamp)`
  - `subtractNoiseFloor(profile, state, strength)`
  - `guardBackoff(...)` (совместимость с текущей self-limiting логикой).

Модель обновления (упрощённая per-bin Kalman):
- Predict: 
  - $x_{k|k-1}=x_{k-1}$
  - $p_{k|k-1}=p_{k-1}+q$
- Update:
  - $K_k=\frac{p_{k|k-1}}{p_{k|k-1}+r}$
  - $x_k=x_{k|k-1}+K_k(z_k-x_{k|k-1})$
  - $p_k=(1-K_k)\,p_{k|k-1}$

Где `z_k` — текущий профиль (или робастная версия, например min(raw, localMedian)).

## 4.3 Интеграция в калибровку

Точки:
- `src/calibration/engine.ts` (ветка `extraCalPings` / сбор `profiles`).
- `src/calibration/env-baseline.ts`.

Изменение:
- при сборе baseline прогонять каждую `prof` через `noise-floor-kalman`;
- сохранять в `CalibrationResult`:
  - `envBaselineRaw` (как было),
  - `envBaselineFiltered` (новое),
  - и использовать filtered как основной baseline при `useCalib`.

## 4.4 Интеграция в скан

Точки:
- `src/scan/ping-cycle.ts` (после `applyQualityAlgorithms`/или до CFAR; выбрать единый порядок и закрепить тестами).
- `src/dsp/clutter.ts` оставить как второй слой, но с согласованным backoff.

Рекомендуемый порядок (MVP):
1. `applyEnvBaseline(...)`
2. `noise-floor-kalman` subtraction
3. `suppressStaticReflections(...)`
4. `computeProfileConfidence(...)` + `caCfar(...)`

Это сохраняет совместимость с текущими механизмами и уменьшает риск регрессий.

## 5) Изменения типов/конфига

`src/types.ts` + `src/core/store.ts` + `src/ui/controls.ts`:

Добавить секции конфигурации:
- `spectrogram: { enabled: boolean; fftSize: number; hopSize: number; minDb: number; maxDb: number; fps: number }`
- `noiseKalman: {
    enabled: boolean;
    processNoiseQ: number;
    measurementNoiseR: number;
    subtractStrength: number;
    freezeOnHighConfidence: boolean;
    highConfidenceGate: number;
    minFloor: number;
    maxFloor: number;
  }`

Сохранить safe defaults:
- фильтр включён по умолчанию только для scan (для калибровки — через флаг первой итерации).

## 6) Поэтапный план внедрения

## Phase A — Каркас спектрограммы (0.5–1 день)

- Добавить `src/viz/mic-spectrogram.ts`.
- Добавить canvas в `index.html`.
- Подключить init/stop в `src/ui/app.ts`.
- Взять поток из `audio:samples`.

Готово, если:
- спектрограмма обновляется после `Init Audio`;
- нет заметных фризов UI.

## Phase B — DSP noise Kalman module (1 день)

- Добавить `src/dsp/noise-floor-kalman.ts`.
- Реализовать predict/update/subtract + clamps/backoff hooks.
- Добавить unit-тесты для математики фильтра.

Готово, если:
- фильтр устойчив на синтетике (стационарный шум + всплески цели);
- при постоянном фоне floor сходится без дрейфа.

## Phase C — Интеграция в calibration (0.5–1 день)

- Пропустить baseline-профили через Kalman noise-floor.
- Расширить `CalibrationResult`.
- Добавить rollback-флаг в конфиг.

Готово, если:
- baseline более гладкий и не «проваливает» реальные пики direct path;
- существующие sanity-метрики не ухудшаются.

## Phase D — Интеграция в scan (1 день)

- Встроить фильтр в `doPingDetailed` и порядок DSP-цепочки.
- Подвязать `confidence` для freeze/slow-update режима.
- Логи/диагностика: retention, collapseRatio, доля updated bins.

Готово, если:
- в шумной сцене уменьшаются ложные пики;
- стабильность выбора направления не хуже baseline.

## Phase E — Тюнинг и rollout (0.5 дня)

- Подобрать defaults под типичные ноутбуки.
- Включить фичу поэтапно (feature flags).
- Обновить README/план миграции.

## 7) План тестирования

Новые тесты:
- `tests/dsp/noise-floor-kalman.test.ts`
  - сходимость floor на стационарном шуме;
  - устойчивость к одиночным всплескам;
  - корректная работа clamps.
- `tests/dsp/noise-floor-kalman-backoff.test.ts`
  - проверка, что backoff не «съедает» сигнал полностью.
- `tests/scan/noise-kalman-integration.test.ts`
  - при включении фильтра падает доля ложных пиков в synthetic scene.
- `tests/calibration/env-baseline-kalman.test.ts`
  - filtered baseline стабильнее raw по дисперсии.

Не ломаем существующие:
- `tests/dsp/clutter.test.ts`
- `tests/dsp/clutter-regression.test.ts`
- `tests/dsp/clutter-self-limiting.test.ts`
- `tests/scan/scan-engine-consensus.test.ts`

## 8) Риски и меры

1. **Риск пере-подавления** слабых реальных целей.
   - Меры: `freezeOnHighConfidence`, ограничение `subtractStrength`, backoff по `peakRetention`.

2. **Риск роста CPU** из-за STFT и per-bin Kalman.
   - Меры: ограничение FPS, `fftSize=512` по умолчанию, обновление Kalman не на каждом кадре UI.

3. **Риск дублирования с existing clutter/envBaseline**.
   - Меры: фиксированный порядок DSP-цепочки + интеграционные тесты на совместимость.

## 9) Definition of Done

Done, когда:
1. Спектрограмма микрофона отображается в реальном времени и не ломает текущий UI flow.
2. Kalman noise-floor работает в calibration и scan по feature flags.
3. Новые тесты зелёные, существующие clutter/scan регрессии проходят.
4. В шумных сценариях наблюдается снижение ложных пиков без потери стабильных целей.
