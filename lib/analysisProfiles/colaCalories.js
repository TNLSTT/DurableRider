const MARKER = '[DurableRider profile: cola_calories]';
const COLA_CALORIES = 139; // 12oz Coca-Cola

function formatNumber(value, digits = 1) {
  if (value == null || Number.isNaN(value)) {
    return 'n/a';
  }
  return Number(value).toFixed(digits);
}

export default {
  key: 'cola_calories',
  label: 'Coca-Cola equivalents',
  description: 'Express calories burned as cans of Coca-Cola and sugar cubes.',
  marker: MARKER,
  async render({ activity, metrics }) {
    const calories = activity.calories ?? activity.kilojoules ?? metrics?.energy ?? null;
    const lines = [MARKER, 'Coca-Cola burn report:'];

    if (calories == null) {
      lines.push('• Calories not available from Strava for this activity.');
      return lines.join('\n');
    }

    const estimatedCalories = Number(calories);
    const cans = estimatedCalories / COLA_CALORIES;
    const sugarGramsPerCan = 39; // grams
    const sugarCubesPerCan = sugarGramsPerCan / 4; // ~4g per cube

    lines.push(`• Estimated ride calories: ${formatNumber(estimatedCalories, 0)} kcal`);
    lines.push(`• Coca-Cola cans burned: ${formatNumber(cans, 1)} × 12oz`);
    lines.push(`• Equivalent sugar cubes: ${formatNumber(cans * sugarCubesPerCan, 1)} cubes`);
    lines.push('');
    lines.push('Fuel idea: swap those cans for real food—fruit, whole grains, and protein.');

    return lines.join('\n');
  },
};
