# Durability Analysis Overview

Durability describes how well a rider maintains power, efficiency, and cardiovascular stability as fatigue accumulates during a ride. This document summarizes the core concepts and metrics required to quantify that resilience using time-series ride data.

## The Power Chain and Loss Points

The torque captured by a power meter is the final output of a multi-link biomechanical chain. Upstream stabilizers can leak efficiency long before force hits the crank. A simplified flow looks like this:

```
Spinal Erectors & Core → Pelvic Stabilization → Hip Extension (Glutes) →
Knee Extension (Quads) → Ankle → Pedal → Crank → Power Meter
```

Each link either transmits energy smoothly or absorbs it through instability, micro-movements, or fatigue. Once spinal erectors or obliques fade, the pelvis rocks, hip angle shifts, and the pedal stroke destabilizes. Indoor trainers can mask these losses; the road exposes them. Durability analysis therefore watches how well those upstream systems hold together beneath the steady power number.

## 1. Core Concept

Durability focuses on how performance decays under sustained load. Key aspects include:

- **Power fade:** the reduction in sustainable power as the ride progresses.
- **Cardiac drift:** how much heart rate rises to sustain the same power output.
- **Efficiency decline:** the drop in watts delivered per heartbeat.
- **Fatigue resistance:** the rider's ability to repeat high-power efforts after prolonged steady work.

## 2. Required Data

Durability analysis works on time-aligned ride samples that, at a minimum, contain:

- Timestamp (seconds)
- Power (watts)
- Heart rate (beats per minute)

Optional fields such as cadence, cumulative kilojoules, or elevation gain can enrich the interpretation but are not strictly required.

Typical sources include `.fit` files or structured API feeds.

## 3. Key Analyses

### a. Power Fade

1. Divide the ride into quartiles: 0–25%, 25–50%, 50–75%, and 75–100% of total duration.
2. Compute average or normalized power for each quartile.
3. Compare the first and last quartiles; the percentage drop indicates how much sustainable power is lost as fatigue builds.

### b. Heart-Rate Drift (Decoupling)

1. Calculate the heart-rate-to-power ratio for early and late ride segments.
2. Evaluate the percent change between segments. A drift greater than roughly 5–10% signals reduced durability.

### c. Cadence Stability Window

1. Focus on the final hour of a long Z2–Z3 ride (or the final quarter if the session is shorter than three hours).
2. Compute the percentage of time cadence stays within ±3 rpm of the window's mean cadence.
3. Track cadence standard deviation; rising jitter signals neuromuscular and postural fatigue even if average cadence holds.

### d. Dual-Side Torque Smoothness

1. If dual-sided data is available, compare left/right balance, torque effectiveness, and pedal smoothness between the first and second halves of the ride.
2. Growing imbalance or declining smoothness reveals upstream force-transmission losses (core, hips, stabilizers) rather than crank-level issues.

### e. Efficiency Factor (EF)

1. Compute the Efficiency Factor as `EF = Normalized Power ÷ Average Heart Rate`.
2. Compare EF between early and late segments to determine how many watts are produced per heartbeat as fatigue accumulates.

### f. Watts per Heartbeat Trend

1. Track watts per beat (W/HR) continuously through the ride.
2. Visualize or regress W/HR over time; a downward slope highlights declining efficiency.

### g. Fatigue-Resistance Curve

1. For multiple time offsets (e.g., 0h, 1h, 2h, 3h), calculate the best rolling 5-, 10-, 20-, and 60-minute powers from that point forward.
2. Plot peak power versus hours into the ride to see how long the athlete can sustain near-fresh efforts.

## 4. Composite Indicators

A composite durability index can combine several metrics:

- Power fade percentage
- Heart-rate decoupling percentage
- Final-hour cadence stability share
- Dual-side torque smoothness deltas
- EF decline percentage
- W/HR trend slope

Weighting these inputs and normalizing the result onto a 0–100 scale yields a single durability score.

## 5. Interpretation Guidelines

- Heart-rate drift under ~5% typically indicates excellent durability.
- Drifts of 10–15% or more, or large power fades, reveal the current fatigue resistance limit.
- A flatter fatigue-resistance curve corresponds to a more durable athlete who maintains higher outputs deeper into the ride.

## 6. Expected Outputs

A complete durability report should include:

- A quartile summary table listing power, normalized power, heart rate, and efficiency factor.
- Heart-rate drift and related percentage metrics.
- A watts-per-heartbeat versus time visualization.
- A fatigue-resistance curve displaying best efforts at increasing time offsets.
- An overall durability score and/or narrative summary of the athlete's resilience.

## 7. Use Cases

Durability analysis supports:

- Tracking whether endurance training improves fatigue resistance.
- Determining race pacing strategies or optimal training intensities.
- Comparing durability across sessions, seasons, or athletes.

