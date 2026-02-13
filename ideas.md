# Echoscope — Cross-Discipline Use Cases

> What can we do with precise acoustic calibration data (sub-ms system delay, mic geometry, environmental baseline, speed-of-sound estimation, multiband frequency response 2-22 kHz, range profiles, angle-of-arrival) running entirely in the browser?

---

## 1. Healthcare & Medical

### 1.1 BabyBreath Guardian — Non-Contact Infant Respiratory Monitor

Non-contact infant respiratory monitoring that tracks breathing rate and detects apnea events through micro-displacement sensing of chest wall movement at 0.5-1 m range.

**How it works:** Active sonar pings detect the 2-5 mm chest-wall displacement at 12-40 breaths/min. The correlation peak for the infant's range bin oscillates in amplitude and phase with each breath cycle. A >10 s cessation triggers an apnea alarm.

**Why calibration matters:**
- Sub-ms system delay subtraction converts raw round-trip time to true range — a 2 s apnea event would be missed if system latency isn't accounted for.
- Environmental baseline removes static room reflections (crib, walls, HVAC), making chest-wall motion the only changing signal.
- Speed-of-sound correction keeps range accurate across nursery temperature swings (18-24 C).

**Target users:** Parents, NICU step-down units, home-care nurses.

---

### 1.2 GaitGuard — Fall-Prediction Gait Analysis

Real-time gait analysis for elderly care that detects shuffling, asymmetric stride patterns, and balance instability predictive of falls — weeks before an actual fall event.

**How it works:** A laptop or tablet on a nightstand continuously scans the room. Foot-strike echoes produce periodic range/angle spikes. Stride length, cadence, step-time variability, and left/right asymmetry are extracted from the time series. Deviation from the user's personal baseline triggers a risk alert to caregivers.

**Why calibration matters:**
- TDOA-derived mic geometry (typically 10 mm Y-offset on laptops) converts time delays into angular position — without it, a person walking at 30 degrees looks identical to -30 degrees.
- Per-band calibration preserves low-frequency footfall impacts (~1 kHz) AND high-frequency scuff sounds (~4 kHz) that indicate different pathologies.
- Environmental baseline removes furniture clutter, isolating the moving person.

**Target users:** Assisted-living facilities, home elder care, physical therapists.

---

### 1.3 Tremor Tracker Pro — Quantitative Tremor Assessment

Non-contact quantitative tremor measurement for Parkinson's (4-6 Hz) vs essential tremor (8-12 Hz). Measures frequency, amplitude, and progression over time without wearables.

**How it works:** The patient holds their hand at 0.5-1.5 m from the device. Coherent integration over 5-10 s windows extracts the 4-12 Hz motion modulation sidebands from the carrier echo. The FFT of the range-bin time series reveals tremor frequency and amplitude.

**Why calibration matters:**
- Environmental baseline (captured during calibration with 6 Golay pings at 0 degrees) characterizes stationary room clutter. During measurement, baseline subtraction at 60% strength removes walls/furniture, leaving only the moving hand.
- Mic geometry enables tracking whether tremor worsens with arms outstretched (+30 degrees) vs at rest (0 degrees).
- Sub-ms timing precision resolves 0.1-0.5 mm chest/hand displacements.

**Target users:** Neurologists, movement-disorder clinics, patients tracking medication efficacy at home.

---

### 1.4 CoughSense — Acoustic TB/Respiratory Screener

Automated respiratory disease screening by analyzing cough acoustic patterns — duration, wet/dry character, frequency spectrum — without requiring a clinic visit.

**How it works:** Patient coughs into a laptop/phone at 0.3-1 m. The 2-22 kHz frequency response captures low-frequency chest resonance (200-800 Hz, indicates sputum) and high-frequency turbulence (5-8 kHz, airway narrowing). Machine learning classifies patterns against known TB, COPD, asthma, and pneumonia signatures.

**Why calibration matters:**
- Per-band TDOA enables frequency-dependent beamforming — isolate the patient's cough from a crying baby 40 degrees away.
- System delay calibration (<1 ms precision) allows accurate measurement of cough duration (TB averages 0.8-1.2 s, non-TB averages 0.3-0.5 s).
- Frequency response calibration compensates for speaker/mic rolloff, ensuring consistent spectral analysis across devices.

**Target users:** Community health workers in resource-limited settings, telemedicine triage.

---

### 1.5 HydroLung — Pulmonary Edema Early Detector

Early detection of fluid accumulation in lungs (heart failure, ARDS) through analysis of breath sounds and shifting chest acoustic resonance frequencies.

**How it works:** Patient sits 0.5 m from the device. Wideband chirps (2-22 kHz) reflect off the chest. As fluid fills alveoli, the chest's acoustic impedance changes, shifting resonant peaks. The system tracks these spectral shifts over days/weeks, alerting clinicians before symptoms worsen.

**Why calibration matters:**
- Calibrated speed of sound converts correlation peaks into anatomical depth — a reflection at 6 ms round-trip indicates tissue at ~1 m.
- Correlation quality metric (sidelobe RMS from Golay autocorrelation) gates measurements: corrQual >0.15 means sharp tissue interface (healthy), <0.15 indicates diffuse scattering (edema).
- Environmental baseline removes room-specific acoustic artifacts.

**Target users:** Heart failure outpatient monitoring, ICU early warning systems.

---

## 2. Smart Home & IoT

### 2.1 ZeroTouch Presence Mapping — Privacy-Preserving Occupancy Detection

Sub-room occupancy detection that distinguishes between humans, pets, and stationary objects without cameras — entirely acoustic and processed on-device.

**How it works:** Continuous sonar pings build a heatmap of the room. Static objects match the environmental baseline and are suppressed. Moving targets appear as range/angle tracks. Micro-Doppler extraction (breathing: 0.1-0.4 Hz, heartbeat: 1-1.5 Hz) classifies a stationary warm body vs an inanimate object.

**Why calibration matters:**
- System delay and mic geometry enable coherent pulse-Doppler processing for micro-motion extraction.
- Environmental baseline subtraction isolates tiny 0.1-1 Hz chest-wall motion, making this work where PIR sensors fail (person sitting still on a couch).
- Multiband analysis: low bands detect large motion (walking), high bands detect small motion (breathing).

**Applications:** Smart HVAC zoning, lighting automation, burglar alarm without cameras, elderly live-alone monitoring.

---

### 2.2 AirFlow Sentinel — HVAC Monitoring & Leak Detection

Monitors HVAC duct airflow and detects blockages, leaks, or filter degradation by tracking speed-of-sound changes caused by temperature gradients.

**How it works:** A phone near a vent runs periodic calibration pings. Air temperature changes the speed of sound by ~0.6 m/s per degree C. By comparing current range-to-wall measurements against the calibrated baseline, the system detects sub-1% speed-of-sound changes indicating blocked vents, dirty filters, or duct leaks.

**Why calibration matters:**
- Golay-based range profiles provide 0.1-1 cm resolution across 2-22 kHz multiband.
- Environmental baseline establishes the "normal" acoustic signature of the duct system.
- Speed-of-sound estimation converts tiny timing shifts into actionable temperature/flow diagnostics.

**Applications:** Predictive HVAC maintenance, energy efficiency auditing, smart thermostat integration.

---

### 2.3 WaterGuard Acoustic — In-Wall Water Leak Detector

Non-contact detection of water infiltration inside walls and ceilings by monitoring changes in acoustic impedance — water-saturated drywall produces measurably different reflection patterns.

**How it works:** A tablet mounted near a wall periodically pings. Water infiltration changes material density, altering ultrasonic reflection coefficients (water: 1500 m/s sound speed vs air: 343 m/s). The system flags deviations from the calibrated "dry wall signature" 12-48 hours before visible stains appear.

**Why calibration matters:**
- Per-band environmental baseline establishes the wall's normal acoustic fingerprint.
- High-frequency bands (8-18 kHz) are most sensitive to moisture changes.
- Speed-of-sound estimation tracks ambient conditions so temperature fluctuations don't create false alarms.

**Applications:** Under-sink monitoring, basement leak detection, vacation-home remote monitoring.

---

### 2.4 GestureZone 3D — Touchless Appliance Control

Ultrasonic hand gesture recognition (swipes, pinch, rotation) for touchless control of smart home devices in the 0.3-1.5 m zone in front of any laptop or tablet.

**How it works:** Continuous chirp pings track hand position in range/angle space. Gesture patterns (swipe = linear range change, pinch = converging dual targets, rotation = circular angle sweep) are classified in real time. Mapped to smart home actions: swipe up = lights brighter, rotate = volume, push = select.

**Why calibration matters:**
- Calibrated mic geometry converts TDOA into precise azimuth (10 degree resolution at 1 m).
- System delay compensation ensures gesture timing is frame-accurate.
- Environmental baseline removes wall/furniture echoes near interaction surfaces where gestures occur.

**Applications:** Kitchen control (dirty hands), bathroom mirror smart display, accessibility for mobility-impaired users.

---

### 2.5 ProxiWake — Context-Aware Device Wake

Detects humans walking toward specific appliances (TV, thermostat, coffee maker) and triggers wake 2-4 seconds before interaction — unlike PIR, it rejects parallel and away motion.

**How it works:** Range profile temporal derivatives compute radial velocity. The system distinguishes "walking toward" (-0.5 to -1.2 m/s) from "walking past" (zero radial velocity) or "walking away" (positive). Approach angle determines which appliance to wake.

**Why calibration matters:**
- Steering delay calibration and mic geometry enable directional discrimination.
- Environmental baseline differentiates a person's approach from HVAC air current changes.
- Speed-of-sound correction prevents false triggers from temperature-induced range drift.

**Applications:** Smart TV pre-wake, thermostat display activation, coffee maker auto-start, energy-saving display management.

---

## 3. Accessibility & Assistive Technology

### 3.1 Acoustic Braille — Personal Space Boundary Detection for Blind Users

Real-time haptic feedback that creates "acoustic walls" around visually impaired users. When someone or something enters the 0.5-1.5 m personal space boundary, direction-specific vibration patterns (left/front/right) alert the user.

**How it works:** A phone in the user's pocket or on a lanyard continuously pings. Range/angle tracks of nearby objects are classified (person approaching, static obstacle, moving vehicle). Vibration motor patterns encode direction and urgency: slow buzz = 1.5 m distant, rapid = 0.5 m, continuous = imminent collision.

**Why calibration matters:**
- Sub-ms system delay and mic geometry provide reliable near-field (<2 m) range accuracy and precise angular discrimination.
- This is the difference between "something is nearby" and "person at 11 o'clock, 0.8 m, approaching."
- Environmental baseline adapts to each location (home vs sidewalk vs store).

**Target users:** Visually impaired navigating crowded environments, supplement to white cane/guide dog.

---

### 3.2 Silent Doorbell — Knock-to-Phone Translator for Deaf Users

Detects door knocks, doorbell presses, or package deliveries via acoustic signatures and sends smartphone push notification with estimated distance — no IoT hardware installation required.

**How it works:** A laptop or tablet running in the background listens for transient acoustic events. Knock signatures (200-800 Hz, 50-200 ms duration) are classified and localized. Range profiles distinguish front door (4 m) from back door (8 m) from window tap (2 m).

**Why calibration matters:**
- Range profile precision from calibrated system delay distinguishes knock sources by distance.
- Frequency response characterization filters HVAC and appliance hum, isolating transient knock signatures.
- Environmental baseline prevents echoes of the knock from triggering duplicate alerts.

**Target users:** Deaf and hard-of-hearing individuals, works with existing laptops — zero installation.

---

### 3.3 Liquid Level Assistant — Pour Detection for Blind Users

Detects liquid rising in a cup or bottle during pouring by tracking the changing acoustic cavity resonance. Triggers haptic alert at 80% and 95% full to prevent overflow.

**How it works:** As liquid fills a container, the air cavity above shrinks, shifting the resonant frequency upward. The system's multiband analysis tracks this 1-2 Hz shift per centimeter of liquid rise. A phone near the cup captures the resonance changes in real time.

**Why calibration matters:**
- Speed-of-sound estimation and sub-ms timing resolution detect 1-2 Hz resonance shifts corresponding to ~1 cm liquid level changes.
- Environmental baseline filters room acoustics, isolating cup resonance modes.
- Frequency response calibration compensates for device variability.

**Target users:** Visually impaired individuals performing daily kitchen tasks.

---

### 3.4 Collision Alarm — Pre-Impact Warning for Wheelchair Users

Forward-looking sonar that warns of upcoming obstacles (doorframes, poles, people) at 1.5-3 m range with <200 ms reaction time. Provides direction-specific alerts for avoidance.

**How it works:** A tablet mounted on the wheelchair armrest scans a 120-degree forward arc. Range/angle profiles detect obstacles and compute closing velocity. Alerts escalate from gentle chime (3 m) to urgent tone (1 m). Angle estimation directs the user to steer left or right.

**Why calibration matters:**
- Calibrated range profiles provide consistent 5-10 cm ranging accuracy for safe stopping distance calculations.
- TDOA-based angle discrimination (via mic position calibration) enables "obstacle at 2 o'clock, 2.1 m" alerts, not just binary detection.
- Speed-of-sound correction maintains accuracy across indoor/outdoor temperature changes.

**Target users:** Powered wheelchair users, especially those with limited peripheral vision or cognitive impairment.

---

### 3.5 Stride Acoustics — Rehabilitation Gait Monitor

Passive gait analysis for mobility-impaired users that tracks rehabilitation progress by detecting improvements in step symmetry, stride length, and cadence over weeks.

**How it works:** A laptop at the end of a hallway captures foot-strike echoes as the patient walks toward it. Step timing, stride length variability, and left/right asymmetry are computed from range profile time series. Progress is logged and visualized for physical therapists.

**Why calibration matters:**
- Environmental baseline subtraction removes static room reflections, isolating dynamic floor-impact echoes.
- Precise system delay calibration (<0.5 ms jitter) detects 2-5 cm stride-length differences between steps.
- Multiband analysis separates heel strikes (low frequency) from toe-off (higher frequency).

**Target users:** Physical therapy clinics, post-stroke rehabilitation, Parkinson's monitoring.

---

## 4. Physical Security (Defensive, Privacy-Preserving)

### 4.1 Silent Sentry — Camera-Free Intrusion Detection

Deploy laptops or tablets as invisible perimeter sensors in sensitive areas (server rooms, labs, offices). Detects human-sized moving objects at 0.3-5 m range and 10-degree angular resolution without cameras or visible sensors.

**How it works:** Continuous low-power sonar pings build a real-time presence map. The environmental baseline learned during setup defines the "empty room" state. Any deviation — a new range/angle target — triggers an alert with location estimate. Works in complete darkness and through smoke.

**Why calibration matters:**
- System delay correction distinguishes genuine motion from HVAC air currents.
- Environmental baseline subtraction makes a person entering an empty room instantly visible as a clean range-angle spike.
- Mic geometry enables accurate triangulation for zone-specific alerting.

**Advantages over cameras:** No privacy concerns, works in dark/smoke, no visual data to hack, no blind spots from lens angle limitations.

---

### 4.2 Glass Guardian — Window Break & Forced Entry Alarm

Monitors windows, glass doors, and walls for vibration signatures indicating break-in attempts. Detects glass fracture transients and forced-entry sounds (lock drilling, door rams).

**How it works:** The multiband frequency response captures high-frequency glass fracture transients (8-20 kHz) and low-frequency forced-entry sounds (200-2000 Hz). The environmental baseline becomes the "normal" acoustic fingerprint. Any deviation — crack propagation, drill vibration — triggers immediate detection before full breach.

**Why calibration matters:**
- Speed-of-sound estimation and sub-ms timing detect mm-scale displacement at glass surfaces via Doppler micro-shifts.
- Golay-based environmental baseline provides a high-SNR "normal" fingerprint.
- Multiband analysis distinguishes glass break (broadband impulse) from wind gusts (low-frequency).

**Applications:** Home security, retail storefronts, museum display cases.

---

### 4.3 Tailgate Trap — Secure Door Anti-Piggybacking

Detects unauthorized followers through restricted-entry doors. Counts distinct range bins crossing the threshold — authorized swipe should produce one echo cluster, two simultaneous clusters within 2 seconds = tailgate alert.

**How it works:** A tablet mounted near the door captures range profiles as people pass through. The 240 range bins at 0.3-5 m coverage give ~2 cm resolution — enough to distinguish two people in tandem with 40 cm minimum separation.

**Why calibration matters:**
- Per-band TDOA rejects coupling artifacts that could false-trigger on door swing itself.
- System delay knowledge prevents counting the same person twice during door movement.
- Environmental baseline adapts to the specific doorway geometry.

**Applications:** Office buildings, data centers, secure government facilities.

---

### 4.4 Heartbeat Sentry — Concealed Human Detection

Detects living humans hiding in supply closets, storage rooms, or vehicle trunks during security sweeps by sensing micro-motion from breathing and heartbeat.

**How it works:** Ultra-sensitive mode uses 7 ms Golay pairs at 2-5 kHz to detect micro-motion on static range bins. A "breathing" signature is identified as range-bin amplitude oscillating at 0.15-0.4 Hz (12-24 breaths/min).

**Why calibration matters:**
- Energy-normalized correlation preserves SNR: human micro-motion yields peak ~0.001-0.01, ambient noise ~0.0001.
- Environmental baseline from 6+ steered pings learns the room's "dead" acoustic signature; subtracting it exposes 0.1-0.5 mm chest-wall displacement.
- Multiband fusion rejects HVAC false positives (broadband) while accepting narrow-band physiological harmonics.

**Applications:** Building security sweeps, law enforcement search operations, customs vehicle inspection.

---

## 5. Music Production & Audio Engineering

### 5.1 Room Mode Death Map — Standing Wave Visualizer

Visualizes standing waves and resonant frequencies in a studio as a thermal heatmap overlaid on room dimensions. Shows exactly where NOT to place monitors or bass traps.

**How it works:** The environmental baseline correlation profiles capture multipath reflections across 300 Hz-5.5 kHz. Combined with calibrated speed-of-sound and distance measurements, the system maps acoustic modes spatially — not just as frequency response graphs, but as physical hot/cold zones in the room.

**Why calibration matters:**
- Multiband environmental baseline captures frequency-dependent reflection patterns.
- Speed-of-sound + precise wall distances enable spatial mapping of modal patterns.
- Mic geometry allows measurement from multiple positions to build the full room map.

**Target users:** Home studio builders, recording studio designers, audiophiles optimizing listening positions.

---

### 5.2 Reverb Pre-Delay Oracle — Room-Aware Reverb Tuning

Analyzes measured early reflections (first 60 ms of correlation peaks) to recommend musically-appropriate reverb pre-delay times for the specific listening position.

**How it works:** The sanity curve correlation data contains early reflection timing with sub-sample precision. The onset detection algorithm isolates direct vs reflected energy, computing the time gap before first reflections. The system recommends pre-delay values that either reinforce the room's natural spaciousness (Haas-zone delays) or mask early reflections.

**Why calibration matters:**
- The earlyMs window (60 ms) and onset detection algorithm isolate direct vs reflected energy with sub-sample precision.
- Suggestions work WITH the room's natural behavior rather than against it.
- Frequency-dependent reflection data shows which bands have problematic early reflections.

**Target users:** Mix engineers, mastering engineers, home producers working in untreated rooms.

---

### 5.3 Speaker Crossover Phase Doctor — Monitor Calibration

Diagnoses crossover phase issues between woofer and tweeter drivers by comparing expected vs measured group delay across frequency bands.

**How it works:** Multiband frequency response (300 Hz-5.5 kHz) and per-band correlation quality reveal frequency regions where driver alignment fails. Since the FIR bandpass filters have known constant group delay, deviations indicate speaker/crossover phase problems rather than DSP artifacts.

**Why calibration matters:**
- Per-band calibration data (quality, corrQualOk, deltaConsistency across fLow/fHigh ranges) reveals frequency-dependent timing anomalies.
- Known DSP group delay is subtracted, isolating speaker-specific issues.
- Golay pair SNR provides clean measurements even at low listening volumes.

**Target users:** Studio monitor calibration, DIY speaker builders, audiophile system tuning.

---

### 5.4 Mirror-Mic Phase Aligner — Multi-Mic Time Alignment

Automatically calculates polarity inversions and time-alignment offsets when recording with multiple microphones (drums, piano, orchestral), preventing comb filtering and phase cancellation.

**How it works:** Calibrated mic positions (X/Y in meters) and per-band tau values provide spatial AND frequency-dependent timing data. The system models how each mic "sees" the source differently based on position and room multipath, then recommends delay/polarity corrections.

**Why calibration matters:**
- Mic position coordinates and per-band measured tau values provide spatial AND frequency-dependent timing data.
- Multiband approach reveals where phase coherence breaks down (low frequencies vs highs due to room modes).
- Sub-ms precision matters: 1 ms misalignment at 1 kHz = complete phase cancellation.

**Target users:** Recording engineers, live sound engineers, broadcast audio.

---

### 5.5 Acoustic Metadata Watermark — Studio Provenance Proof

Embeds the room's unique acoustic fingerprint (impulse response hash derived from environmental baseline + reflection pattern) into music releases as inaudible metadata proving recording origin.

**How it works:** The environmental baseline Float32Array is a normalized acoustic fingerprint of the room's response. Combined with multiband correlation patterns and geometry measurements, it creates a unique, reproducible signature. Producers publish the signature; fans with the app can verify a track was mixed in a specific studio.

**Why calibration matters:**
- Environmental baseline is a unique, reproducible room signature nearly impossible to fake without access to the actual physical space.
- Multiband data adds spectral dimensionality to the fingerprint.
- Golay-based capture ensures high SNR and repeatability.

**Target users:** Record labels, auction houses verifying master recordings, music historians.

---

## 6. Robotics & Automotive

### 6.1 Blind Spot Buddy — Cyclist Proximity Warning

Cyclists mount their phone on handlebars for rear blind-spot detection. Detects approaching vehicles at 0.5-3 m behind the rider, where radar is cost-prohibitive.

**How it works:** Active sonar pings rearward. Range-rate tracking (differentiated range profiles) distinguishes approaching cars (negative range rate) from parked obstacles (zero range rate). Multiband calibration adapts to road noise, wind, and rain. The angle-reliable flag gates bearing estimates — only showing "car at 5 o'clock" when geometry is trustworthy.

**Why calibration matters:**
- System delay compensation enables 0.5-3 m vehicle detection accuracy.
- Multiband frequency response calibration adapts to outdoor noise conditions.
- Speed-of-sound correction for outdoor temperature variation (0-40 C range).

**Target users:** Urban cyclists, motorcycle riders, delivery couriers.

---

### 6.2 Dock & Drop — Robotic Forklift Pallet Alignment

Autonomous forklifts use tablet-mounted sonar to verify pallet position and orientation before engaging forks, even when visual markers are obscured by shrink-wrap.

**How it works:** Golay complementary-pair chirps (with calibrated sidelobe cancellation) distinguish pallet corners from nearby stacked boxes. Precise mic geometry enables 3D pose estimation via 2-mic TDOA. Environmental baseline suppresses floor reflections for sub-5 cm pallet localization.

**Why calibration matters:**
- Golay sidelobe cancellation distinguishes pallet corners from nearby clutter.
- Mic geometry enables angle estimation for pose determination.
- Environmental baseline removes persistent warehouse multipath.

**Target users:** Warehouse automation, logistics centers, manufacturing.

---

### 6.3 AGV Whisper Net — Factory Robot Peer-to-Peer Localization

Autonomous ground vehicles in factories use acoustic peer-to-peer ranging when GPS/UWB fails near metal enclosures and EMI-noisy environments.

**How it works:** Each AGV runs the sonar app on an embedded Android board. Multiband calibration (900-5.5 kHz) characterizes the acoustic channel through EMI-noisy environments. Mic geometry auto-detection discovers array configuration after hardware maintenance (speaker replacements), eliminating manual re-surveying. GCC-PHAT confidence triggers fallback to dead reckoning when acoustic SNR drops.

**Why calibration matters:**
- Mic geometry auto-detection eliminates manual re-surveying after maintenance.
- Environmental baseline removes CNC machine echoes and HVAC hum.
- Multiband calibration ensures robustness near metal/EMI sources.

**Target users:** Electronics manufacturing, automotive assembly lines, pharmaceutical cleanrooms.

---

### 6.4 Convoy Glue — Truck Platooning Inter-Vehicle Spacing

Highway truck platoons use phone mounts for acoustic ranging between vehicles, maintaining safe following distance for cooperative adaptive cruise control (CACC).

**How it works:** Calibrated system delay removes 20-50 ms latency variations across Android/iOS devices, enabling consistent 10-30 m gap measurement. Speed-of-sound temperature correction maintains accuracy across altitude changes (mountain passes, desert valleys). Clutter suppression filters bridge overpasses and roadside barriers.

**Why calibration matters:**
- System delay removal provides consistent measurements across heterogeneous phone fleet.
- Speed-of-sound temperature correction for altitude/weather changes.
- Kalman tracker range-rate output feeds directly into throttle/brake controllers.

**Target users:** Long-haul trucking fleets, logistics companies, autonomous vehicle developers.

---

## 7. STEM Education & Citizen Science

### 7.1 Sound Speed Detective — Environmental Physics Lab

Students measure temperature and humidity across locations (classroom, hallway, outdoors) and use calibration data to reverse-engineer the local speed of sound — making abstract thermodynamics tangible.

**How it works:** Students run calibration in different environments and compare the measured speed of sound. Since the system knows the precise speaker-to-mic distance, any speed-of-sound variation directly reveals environmental differences. The sub-ms timing lets them detect temperature differences of just 2-3 C.

**Why calibration matters:**
- Known mic-speaker distance isolates environmental effects from geometry.
- Sub-ms precision detects temperature changes below what a thermometer might show.
- Speed-of-sound estimation is a direct lab output, not a hidden parameter.

**Curriculum fit:** High school physics (waves, thermodynamics), AP Physics, university acoustics courses.

---

### 7.2 Impulse Response Explorer — DSP Course Lab

University DSP students visualize how room acoustics affect signal propagation by comparing environmental baselines across different spaces — anechoic closets vs tiled bathrooms vs carpeted lecture halls.

**How it works:** Students capture Golay-pair impulse responses in various rooms. They compare frequency responses (2-22 kHz), RT60 decay times, and early reflection patterns. They correlate spectral peaks/nulls with room dimensions and surface materials.

**Why calibration matters:**
- Golay pair correlation provides clean, high-SNR impulse captures superior to textbook examples.
- Multiband calibration shows which frequencies survive reflections best.
- Real data on real hardware, not simulated — students can hear the difference.

**Curriculum fit:** University DSP courses, audio engineering programs, acoustics electives.

---

### 7.3 Geometry Phantom Lab — Radar Cross-Section Practicum

Students build cardboard "phantoms" (corner reflectors, spheres, flat plates) and measure reflection strength to discover radar cross-section empirically — why corner reflectors produce 10x stronger echoes than flat surfaces.

**How it works:** Calibrated range profiles give absolute distance measurements students can verify with rulers. Energy-normalized correlation quantifies echo strength. Students compare different shapes, sizes, and materials, building intuition for sonar/radar principles.

**Why calibration matters:**
- System delay removal enables absolute ranging — students validate against physical measurements.
- Energy normalization provides consistent, comparable echo strength measurements.
- Angle estimation lets students measure the angular extent of reflectors.

**Curriculum fit:** High school physics, engineering intro courses, science fair projects.

---

### 7.4 Bat Simulation Science Fair — Biomimicry Project

Students compare human-designed sonar signals (chirp vs MLS vs Golay) against bat echolocation strategies, learning about time-bandwidth product through hands-on A/B testing.

**How it works:** Students switch between signal types and compare detection range, resolution, and noise immunity. They discover why bats use FM sweeps (like chirps) — good range resolution. They measure minimum detectable range (limited by speaker-mic coupling, visible in calibration sanity plots) and compare to bat performance.

**Why calibration matters:**
- Correlation quality metrics quantify "echo clarity" objectively for each signal type.
- Calibration sanity plots reveal the speaker-mic coupling that limits minimum range — analogous to bat call-hearing overlap.
- Multiple signal types are already implemented and ready to compare.

**Curriculum fit:** Middle/high school biology (biomimicry), AP Biology, science fair projects.

---

### 7.5 Material Fingerprinting Challenge — Acoustic Spectroscopy

Engineering students build a "material scanner" by analyzing frequency-dependent reflection strength across calibration bands. They discover that wood absorbs high frequencies, metal reflects them, and fabric absorbs everything.

**How it works:** Students aim the sonar at different surfaces and compare per-band reflection strengths. They build a material classification database and test it on unknown samples. They learn about acoustic impedance, absorption coefficients, and spectral analysis.

**Why calibration matters:**
- Per-band calibration results (which frequencies gave valid vs invalid calibration) directly reveal material properties.
- Frequency response characterization provides consistent, comparable measurements.
- Environmental baseline subtraction isolates the target material's reflection from room clutter.

**Curriculum fit:** Engineering design courses, materials science, acoustics.

---

### 7.6 Acoustic Doppler Workshop — Velocity Measurement

Students attach phones to remote-control cars and measure motion-induced Doppler shifts in wall echoes, validating the Doppler equation experimentally.

**How it works:** The sub-ms timing precision reveals frequency shifts as small as 5-10 Hz from a car moving at 0.5 m/s. Students correlate velocity estimates from range-rate (differentiated range profiles) vs frequency shift, verifying both methods agree.

**Why calibration matters:**
- Calibrated geometry ensures the mic-speaker baseline is known, making velocity vector decomposition possible.
- System delay subtraction isolates true Doppler shift from system artifacts.
- Speed-of-sound calibration converts frequency shift to velocity accurately.

**Curriculum fit:** AP Physics, university mechanics, advanced physics labs.

---

## 8. Gaming & Interactive Entertainment

### 8.1 Chiroptera — Bat Simulator Experience

Navigate a pitch-black virtual cave using only echolocation clicks. Real furniture becomes stalagmites and obstacles. Move your head and the acoustic scene updates in real time.

**How it works:** The room's actual impulse response becomes the "cave fingerprint." Low frequencies (2-4 kHz) penetrate farther for navigation, while high frequencies (16-22 kHz) reveal fine texture details. Players trigger sonar by tongue clicks or finger snaps. The visual rendering inverts the sonar heatmap — brighter means stronger echo.

**Why calibration matters:**
- Environmental acoustic baseline captures the room's actual impulse response, becoming the cave.
- Multiband calibration provides frequency-dependent ranging — different "vision modes."
- Speed-of-sound ensures range accuracy for believable spatial mapping.

**Platform:** Browser-based, works on any laptop — no VR headset required (audio-only mode or simple 2D rendering).

---

### 8.2 Phantom Orchestra — Gesture-Controlled Air Instruments

Conduct an invisible symphony by "playing" air instruments in calibrated 3D space. Strum at chest level, tap air drums at specific angles, bow a virtual cello.

**How it works:** The heatmap's angle x range bins (30 angles x 128 range bins) create a voxel grid where each virtual instrument lives. Hand motion in a specific voxel triggers the corresponding instrument sample. Kalman-filtered velocity tracking distinguishes slow bowing from fast strumming for dynamic expression control. Range rate maps to volume, angle rate maps to pitch bend.

**Why calibration matters:**
- Calibrated distances define "instrument positions" in physical space.
- Motion velocity tracking (Kalman filter range/angle rates) enables expressive performance.
- Environmental baseline removes furniture echoes so only intentional hand motion triggers instruments.

**Platform:** Browser-based, party game mode with multiple players.

---

### 8.3 Echoscape — Procedural Audio-Reactive Art Installation

An ambient installation that generates evolving 3D landscapes from room acoustics. Walk toward a wall and mountains rise. Multiple people create multi-avatar interactions spawning generative music and particle effects.

**How it works:** The environmental baseline provides a static "map" of room geometry that seeds a procedural terrain generator. Real-time range profiles detect movement, with position/velocity driving landscape morphing. Multiple people (3-5 tracked via multi-target association) each have avatars whose interactions generate collaborative visual/audio art.

**Why calibration matters:**
- Environmental baseline provides static room "map" for procedural seed.
- Multi-target tracking (Kalman + Mahalanobis gating) supports 3-5 simultaneous participants.
- Multiband frequency data drives biome selection (low-freq = water, mid = forest, high = crystal).

**Venue:** Gallery installations, museum exhibits, interactive public art.

---

### 8.4 Soundstrike — Rhythm Combat Game

A rhythm game where you deflect attack patterns by clapping, stomping, or vocalizing at precise angles and distances. Enemy attacks approach as sonar blips; your defensive strikes must match both beat and spatial location.

**How it works:** Enemy attacks appear at calibrated angular positions via steered beamforming. Clap toward the left speaker at 45 degrees to block a left-side attack. The GCC-PHAT angle estimator provides real-time feedback on strike direction accuracy within 3 degrees. Timing windows match typical rhythm game precision (50-200 ms).

**Why calibration matters:**
- TDOA-based geometry converts clap arrival-time differences into precise azimuth angles.
- System delay removal keeps timing judgment frame-perfect.
- Environmental baseline subtraction means only intentional sounds register as "hits."

**Platform:** Browser-based, competitive multiplayer via WebRTC.

---

## 9. Fitness & Sports Science

### 9.1 RepForm — Real-Time Weightlifting Form Coach

Tracks barbell path, velocity, and symmetry during weightlifting reps (squats, bench press, deadlifts) without any wearables — just a phone on the floor or bench.

**How it works:** Active sonar tracks the barbell (strong metal reflector) in range/angle space. Bar velocity profile reveals eccentric/concentric phases, sticking points, and acceleration. Mic geometry detects lateral bar path deviation from vertical. Reps are automatically counted and graded.

**Why calibration matters:**
- Sub-cm tracking from system delay enables velocity-based load prescription (VBT training).
- Mic geometry measures bar path deviation — critical for squat/bench safety.
- Speed-of-sound correction prevents drift during sweaty gym temperature changes.

**Target users:** Powerlifters, Olympic weightlifters, strength coaches, CrossFit athletes.

---

### 9.2 JumpLab — Vertical Jump & Plyometric Analyzer

Measures takeoff velocity, flight time, landing impact, and bilateral asymmetry during jumps — replacing expensive force plates with a phone on the floor.

**How it works:** The system tracks the jumper's body (torso/legs) in the range profile. Flight time = gap between takeoff (echo disappears from ground-level bin) and landing (echo reappears). Jump height = 1/2 * g * (t/2)^2. Mic geometry enables left/right foot timing detection for bilateral deficit analysis.

**Why calibration matters:**
- System delay calibration: 1 ms error = 2 cm jump height error — calibration is essential.
- Mic geometry detects 5-10 ms left/right timing differences indicative of injury risk.
- Environmental baseline removes floor reflections for clean takeoff/landing detection.

**Target users:** Basketball/volleyball players, track & field athletes, sports performance labs.

---

### 9.3 PunchTracker — Boxing Speed & Reach Monitor

Measures jab speed, cross extension, hook arc radius, and retraction time during shadowboxing — no gloves, sensors, or cameras needed.

**How it works:** Precise delay calibration differentiates fast jabs (peak velocity 8-10 m/s) from slower hooks. Angle estimation tracks punch trajectory (jab = straight ahead, hook = lateral arc). Velocity profiles identify acceleration/deceleration phases critical for power generation. Retraction speed (often neglected in training) is tracked separately.

**Why calibration matters:**
- Sub-ms timing resolves the 100-300 ms duration of a punch at high velocity.
- Angle estimation tracks punch trajectory and detects dropped guard.
- Environmental baseline ensures only the fist is tracked, not bag swing or rope skipping.

**Target users:** Boxers, MMA fighters, personal trainers, fitness enthusiasts.

---

### 9.4 FlowYoga — Balance & Transition Tracker

Monitors movement velocity during vinyasa flows and micro-oscillation amplitude (<1 cm) during balance holds (tree pose, warrior III). Generates a "stability score" for each pose.

**How it works:** Range profiles detect center-of-mass sway during static holds. The FFT of range-bin time series reveals sway frequency (lower = better balance). Transition speed between poses is computed from range-rate. Progress is tracked over weeks to show improving stability.

**Why calibration matters:**
- Calibrated range profiles detect sub-cm sway that would be invisible to cameras.
- Environmental baseline ignores ceiling fans and pets while isolating the yogi's motion.
- Multiband analysis separates large movements (transition) from small movements (breathing, sway).

**Target users:** Yoga practitioners, physical therapists, balance-training programs for elderly.

---

## 10. Architecture, Construction & Real Estate

### 10.1 Stud Finder Pro — Acoustic Wall Scanner

Locate wall studs, joists, and structural members behind drywall by detecting acoustic impedance changes at wood-to-air boundaries — using only a laptop speaker and microphone.

**How it works:** Wideband chirps (2-22 kHz) are directed at the wall. Hollow cavities produce strong reflections; solid framing (wood studs) dampens the return. Scanning laterally, the reflection amplitude modulates with stud spacing (typically 16" on center). The system marks stud positions on a visual display.

**Why calibration matters:**
- Precise system delay enables mm-accurate depth measurement to distinguish drywall-air vs drywall-stud interfaces.
- Frequency response across 2-22 kHz: low frequencies penetrate deeper, high frequencies resolve smaller features.
- Environmental baseline removes ambient room reflections from the measurement.

**Target users:** DIY homeowners, contractors, renovation professionals.

---

### 10.2 Moisture Migration Mapper — Hidden Water Damage Detector

Detects hidden water damage, wet insulation, or active leaks inside walls by measuring abnormal acoustic velocity changes — water-saturated drywall slows sound by 15-20%.

**How it works:** The environmental baseline captured during initial calibration (dry conditions) provides a "known-good" signature. Weekly re-scans compare current acoustic properties. Dampened high-frequency returns and shifted speed-of-sound estimates flag moisture zones 12-48 hours before visible stains.

**Why calibration matters:**
- Environmental baseline = "dry wall signature" — deviations are immediately flagged.
- High-frequency bands (8-18 kHz) are most sensitive to moisture changes.
- Speed-of-sound estimation tracks changes caused by moisture, not just temperature.

**Target users:** Home inspectors, property managers, insurance adjusters.

---

### 10.3 Room Volume & RT60 Calculator — Instant Acoustic Survey

Automatically computes room volume, dimensions, and RT60 (reverberation time) by analyzing the decay envelope of wall reflections in the captured impulse response.

**How it works:** Calibrated distance measurements to each wall (from range profiles at multiple angles) reconstruct 3D room geometry. The impulse response decay curve yields RT60 per frequency band. Combined, this provides a complete acoustic survey of the room — normally requiring a $5,000 measurement rig.

**Why calibration matters:**
- Calibrated mic geometry and precise wall distances reconstruct 3D room shape.
- Environmental baseline provides true absorption coefficients per surface.
- Speed-of-sound ensures distance accuracy to within 1-2 cm.

**Target users:** Architects, acoustic consultants, home theater installers, real estate agents (room dimensions without laser measurers).

---

### 10.4 Window Seal Integrity Tester

Verifies double/triple-pane window seal integrity by measuring the acoustic reflection pattern between glass layers — a failed seal (moisture intrusion, argon gas leak) changes the impedance profile.

**How it works:** A phone held against or near the window pane sends chirps. The sub-ms system delay resolution resolves the 12-16 mm gap between panes. The reflection pattern for intact seal (air or argon cavity) differs from failed seal (moisture, vacuum loss). The heatmap reveals non-uniform spacing indicating seal failure or glass delamination.

**Why calibration matters:**
- Sub-ms resolution can resolve the narrow 12-16 mm gap between panes.
- Frequency response characterization identifies which bands best penetrate glass.
- Environmental baseline removes reflections from frames and nearby surfaces.

**Target users:** Window manufacturers QA, home inspectors, energy auditors.

---

### 10.5 Concrete Void & Delamination Detector

Inspects concrete slabs, walls, and foundations for internal voids, honeycombing, or rebar delamination by detecting abnormal echo patterns from impedance mismatches.

**How it works:** The chirp signal's wide bandwidth (2-22 kHz) penetrates concrete better than ultrasonic-only tools. Golay complementary pairs provide 6-12 dB noise rejection — essential for noisy construction sites. Void detection works by comparing reflection strength: solid concrete absorbs energy, voids create strong impedance-mismatch echoes.

**Why calibration matters:**
- System delay measurement prevents confusing latency artifacts with structural features.
- Golay SNR advantage makes a smartphone viable on noisy job sites.
- Multiband analysis: low frequencies penetrate deeper into concrete, high frequencies resolve smaller voids.

**Target users:** Structural engineers, bridge inspectors, construction QA teams.

---

## 11. Wildlife & Environmental Monitoring

### 11.1 Bat Roost Exit-Counter — Colony Health Monitor

Counts individual bats emerging from cave roosts at dusk using flight-speed estimation from Doppler shifts in 18-22 kHz chirps. Maps flight corridors and detects colony health from emergence timing patterns.

**How it works:** Phones deployed at cave entrances capture echoes from flying bats (10+ m/s). Mic geometry resolves individual flight trajectories in 3D space. Nightly counts and timing patterns reveal colony size trends, reproductive success, and disturbance impacts — all from $200 hardware instead of $20,000 thermal cameras.

**Why calibration matters:**
- Sub-ms system delay prevents range ambiguity for fast-moving targets.
- Mic geometry enables 3D trajectory reconstruction.
- Environmental baseline removes cave wall echoes and ambient drip sounds.

**Target users:** Wildlife biologists, conservation agencies, wind farm impact assessors.

---

### 11.2 Pollinator Activity Profiler — Precision Agriculture

Distinguishes pollinator species by wing-beat harmonics and maps pollinator density across crop rows. Growers optimize pesticide spray timing to avoid peak pollination windows.

**How it works:** Multiband frequency response (2-22 kHz) captures size-dependent wing-beat harmonics: honeybees (~200 Hz fundamental, 8 kHz harmonics), bumblebees (~150 Hz, 6 kHz), hoverflies (~120 Hz, 5 kHz). Range profiles + motion tracking distinguish hovering (pollinating) from transit. Hourly heatmaps show pollinator density by location.

**Why calibration matters:**
- Frequency response calibration ensures consistent harmonic detection across device variability (speaker aging, mic dust).
- Range profiles (0.3-4 m) separate near-field pollinators from distant noise sources.
- Speed-of-sound correction for outdoor field temperature variation.

**Target users:** Farmers, agricultural researchers, conservation biologists.

---

### 11.3 Coral Reef Acoustic Rugosity — Reef Health Monitor

Monitors reef health via surface complexity measurement — healthy coral produces rich multipath (high rugosity), bleached/dead coral is acoustically smooth (low rugosity).

**How it works:** Waterproof phone housings on reef edges ping the reef face. Golay complementary pairs (sidelobe cancellation) resolve fine 3D structure. Frequency-dependent absorption in seawater maps algae/sediment cover. Monthly scans detect bleaching onset weeks before visible color change. Range bins track coral growth rates at mm/year resolution.

**Why calibration matters:**
- Golay sidelobe cancellation resolves fine 3D structure.
- Multiband analysis: high-frequency loss in seawater maps surface cover.
- Environmental baseline distinguishes reef structure from water column scattering.

**Target users:** Marine biologists, reef conservation programs, citizen-science diving groups.

---

### 11.4 Avalanche/Rockfall Early Warning

Monitors cliff faces and steep slopes for pre-failure micro-movements. Detects scree movement and rock detachment 30-90 seconds before debris reaches trail level.

**How it works:** Weatherproof phones on cliff faces perform periodic scans. The calibrated system learns baseline acoustic signature (wind, water seepage) during safe periods. Sudden deviations in range profile variance + high-frequency content (>10 kHz scree movement) trigger alerts. Kalman-filtered motion tracks accelerating debris.

**Why calibration matters:**
- Environmental baseline learns site-specific clutter during safe periods; deviations trigger alerts.
- Mic geometry enables source localization: distinguish distant thunder from proximal rock detachment.
- Speed-of-sound correction for altitude and temperature at mountain elevations.

**Target users:** Mountain trail management, ski resorts, mining operations, civil protection agencies.

---

### 11.5 Migratory Bird Stopover Habitat Assessment

Deploys phone arrays in wetland restoration sites to track individual bird positions in dense flocks, revealing preferred microhabitats and validating habitat design.

**How it works:** Stereo phones spaced 1-2 m use calibrated TDOA to resolve individual bird positions in dense shorebird flocks. Range profiles distinguish foraging (stationary, 0.5-2 m height) from roosting (low velocity, clustered). Multi-hour heatmaps compare restored vs degraded sites.

**Why calibration matters:**
- TDOA calibration from known speaker separation provides angle accuracy needed to separate closely-spaced birds (<10 degrees apart).
- Environmental baseline adapts to each wetland site's unique acoustic environment.
- Multiband analysis captures different-sized birds at appropriate frequency ranges.

**Target users:** Ornithologists, habitat restoration ecologists, environmental impact assessors.

---

## Summary: Most Commercially Promising Near-Term Opportunities

| Priority | Domain | Use Case | Why Now |
|---|---|---|---|
| 1 | Accessibility | Acoustic Braille, Silent Doorbell, Liquid Level | Huge unmet need, zero hardware cost, runs on existing devices |
| 2 | Smart Home | ZeroTouch Presence, ProxiWake | Privacy-preserving alternative to cameras, no IoT purchase |
| 3 | Education | Sound Speed Detective, Bat Simulation | Every student has a laptop, aligns with STEM curriculum |
| 4 | Healthcare | BabyBreath Guardian, Tremor Tracker | Non-contact monitoring trend, telemedicine integration |
| 5 | Audio | Room Mode Death Map, Reverb Oracle | Democratizes acoustic measurement for home studios |
| 6 | Construction | Stud Finder Pro, Moisture Mapper | Replaces specialized hardware with a phone |
| 7 | Fitness | JumpLab, RepForm | Replaces $500+ force plates and VBT devices |
| 8 | Security | Silent Sentry, Glass Guardian | Privacy-first security, works in darkness |
| 9 | Wildlife | Bat Exit-Counter, Pollinator Profiler | Citizen science at 1/100th cost of traditional equipment |
| 10 | Gaming | Chiroptera, Phantom Orchestra | Novel interaction paradigm, viral potential |

---

*The common enabler across all domains: calibration transforms a commodity laptop/phone into a precision acoustic instrument. The trifecta of sub-ms system delay, mic geometry, and environmental baseline is what separates "something moved" from "a 70 kg human is 2.3 m away at 11 o'clock, approaching at 0.8 m/s."*
