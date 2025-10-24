const MARKER = '[DurableRider summary v0.1]';

function formatNumber(value, { suffix = '', digits = 1, defaultText = 'n/a' } = {}) {
  if (value == null || Number.isNaN(value)) {
    return defaultText;
  }
  return `${value.toFixed(digits)}${suffix}`;
}

function formatBaselineComparison(current, baseline, { suffix = '', digits = 1 } = {}) {
  if (current == null) {
    return 'n/a';
  }
  const value = formatNumber(current, { suffix, digits });
  if (baseline == null) {
    return value;
  }
  const delta = current - baseline;
  const sign = delta >= 0 ? '+' : '';
  const deltaText = `${sign}${Math.abs(delta).toFixed(digits)}${suffix}`;
  return `${value} (${deltaText} vs baseline)`;
}

function buildDescription({ metrics, baseline, hrr, cadenceSummary, context }) {
  const durabilityScoreText =
    metrics.durabilityScore == null ? 'n/a' : `${Math.round(metrics.durabilityScore)}/100`;
  const lines = [
    MARKER,
    'Durability snapshot:',
    `• Durability score: ${durabilityScoreText}`,
    `• Power fade Q1→Q4: ${formatNumber(metrics.powerFade, { suffix: '%', digits: 1 })}`,
    `• Pw:HR drift (1st vs 2nd half): ${formatBaselineComparison(metrics.pwHrDrift, baseline?.pwHrDrift, { suffix: '%', digits: 1 })}`,
    `• Efficiency decline: ${formatNumber(metrics.efficiencyDecline, { suffix: '%', digits: 1, defaultText: 'n/a' })}`,
    `• W/HR slope: ${formatNumber(metrics.wattsPerBeatTrend?.slopePercentPerHour, { suffix: '%/h', digits: 1 })}`,
    `• Rolling 5min delta: ${formatBaselineComparison(metrics.rolling5Diff, baseline?.rolling5Diff, { suffix: ' W', digits: 0 })}`,
    `• Power @150 bpm delta: ${formatBaselineComparison(metrics.power150Delta, baseline?.power150Delta, { suffix: ' W', digits: 0 })}`,
    `• Z2 share early→late: ${formatNumber(metrics.z2Early, { suffix: '%', digits: 1 })} → ${formatNumber(metrics.z2Late, { suffix: '%', digits: 1 })}`,
  ];

  if (metrics.cadenceStability) {
    const stabilityPercent = formatNumber(metrics.cadenceStability.ratioPercent, { suffix: '%', digits: 0 });
    const stabilityText = stabilityPercent === 'n/a' ? 'n/a' : `${stabilityPercent} in ±3 rpm`;
    lines.push(
      `• Final-hour cadence stability: ${stabilityText} | σ ${formatNumber(metrics.cadenceStability.stdDev, { suffix: ' rpm', digits: 1 })}`,
    );
  }

  lines.push(`• Cadence/HR fatigue: ${cadenceSummary}`);

  if (hrr?.z2HrrShare != null) {
    lines.push(`• HRR-based Z2 share: ${formatNumber(hrr.z2HrrShare, { suffix: '%', digits: 1 })}`);
  }

  if (metrics.dualSideBalance) {
    const dualParts = [];
    if (metrics.dualSideBalance.leftRightBalance?.shift != null) {
      dualParts.push(
        `L/R shift ${formatNumber(metrics.dualSideBalance.leftRightBalance.shift, { suffix: '%', digits: 1 })}`,
      );
    }
    if (metrics.dualSideBalance.torqueEffectiveness?.delta != null) {
      dualParts.push(
        `Torque Δ ${formatNumber(metrics.dualSideBalance.torqueEffectiveness.delta, { suffix: '%', digits: 1 })}`,
      );
    }
    if (metrics.dualSideBalance.pedalSmoothness?.delta != null) {
      dualParts.push(
        `Smoothness Δ ${formatNumber(metrics.dualSideBalance.pedalSmoothness.delta, { suffix: '%', digits: 1 })}`,
      );
    }
    if (dualParts.length > 0) {
      lines.push(`• Dual-side stability: ${dualParts.join(' | ')}`);
    }
  }

  lines.push('');

  if (metrics.quartiles?.length) {
    lines.push('Quartile profile (Avg P | NP | HR | EF):');
    metrics.quartiles.forEach((quartile, index) => {
      const label = `Q${index + 1}`;
      const avgPower = formatNumber(quartile.avgPower, { suffix: ' W', digits: 0 });
      const np = formatNumber(quartile.normalizedPower, { suffix: ' W', digits: 0 });
      const hr = formatNumber(quartile.avgHr, { suffix: ' bpm', digits: 0 });
      const ef = formatNumber(quartile.efficiencyFactor, { digits: 2 });
      lines.push(`${label}: ${avgPower} | NP ${np} | ${hr} | EF ${ef}`);
    });
    lines.push('');
  }

  if (metrics.wattsPerBeatTrend) {
    const trend = metrics.wattsPerBeatTrend;
    const start = formatNumber(trend.start, { digits: 2 });
    const end = formatNumber(trend.end, { digits: 2 });
    lines.push(`W/HR trend: ${formatNumber(trend.slopePerHour, { digits: 2 })} W·bpm⁻¹/h (${start} → ${end})`);
    lines.push('');
  }

  if (metrics.fatigueResistance?.length) {
    lines.push('Fatigue resistance (best average power):');
    metrics.fatigueResistance.forEach((entry) => {
      const hours = (entry.offset / 3600).toFixed(1);
      const segments = Object.entries(entry.bestByDuration)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([duration, power]) => {
          const minutes = Math.round(Number(duration) / 60);
          return `${minutes}' ${formatNumber(power, { suffix: ' W', digits: 0 })}`;
        });
      if (segments.length > 0) {
        lines.push(`T+${hours}h → ${segments.join(' | ')}`);
      }
    });
    lines.push('');
  }

  if (context?.indoor != null) {
    const tags = [];
    tags.push(context.indoor ? 'Indoor' : 'Outdoor');
    if (context.temperature) {
      tags.push(`Temp: ${context.temperature}°C`);
    }
    if (context.altitude != null) {
      tags.push(`Altitude gain: ${context.altitude.toFixed(0)} m`);
    }
    lines.push(`• Ride context: ${tags.join(' | ')}`);
  }

  lines.push('');
  return `${lines.join('\n')}`;
}

export default {
  key: 'durable',
  label: 'Durable baseline summary',
  description: 'Detailed durability, cadence, and power fade analysis.',
  marker: MARKER,
  async render({ metrics, baseline, hrr, cadenceSummary, context }) {
    return buildDescription({ metrics, baseline, hrr, cadenceSummary, context });
  },
};
