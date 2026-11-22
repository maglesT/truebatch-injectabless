import type { BlockSetting } from './format.js';

// The recorded side of a cycle against its recipe (template round part 5, I21): the time of each phase and the lowest and
// highest of its key parameter, from the printout, in the recipe's order.
export const cycleFields = [
  { name: 'phaseMinutes', label: 'Time of each phase (printout, in the recipe\'s order)', kind: 'number' as const, unit: 'min', count: '$phases' },
  { name: 'phaseMin', label: 'Lowest value in each phase (printout)', kind: 'number' as const, unit: '$paramUnit', count: '$phases' },
  { name: 'phaseMax', label: 'Highest value in each phase (printout)', kind: 'number' as const, unit: '$paramUnit', count: '$phases' },
];
export const cycleSettings: BlockSetting[] = [
  { name: 'phases', label: 'Phases in the recipe', kind: 'number' },
  { name: 'phaseRecipe', label: 'The recipe: phases separated by "|", each "name; minutes; range" (e.g. "Hold; 15 to 20; 121 to 124")', kind: 'text' },
  { name: 'paramName', label: 'The parameter checked in each phase (e.g. Chamber temperature)', kind: 'text' },
  { name: 'paramUnit', label: 'Its unit', kind: 'text', options: ['°C', 'mbar', 'µbar', 'bar'] },
];
export const cycleCalc = { name: 'cycle', label: 'Cycle against the recipe (phases, times, total time)', template: 'I21L', args: { recipe: '$phaseRecipe', minutes: '$phaseMinutes', parameterMin: '$phaseMin', parameterMax: '$phaseMax', parameter: '$paramName', unit: '$paramUnit' } };

