/**
 * Crafting recipes — simple ingredient list → output item.
 * Ingredient ids are inventory stack ids (items or collectible blocks).
 */
export const RECIPES = [
  {
    id: 'bomb',
    output: 'bomb',
    count: 1,
    ingredients: [
      { id: 'iron', count: 1 },
      { id: 'coal', count: 1 },
    ],
  },
  {
    id: 'pickaxe',
    output: 'pickaxe',
    count: 1,
    ingredients: [
      { id: 'log', count: 1 },
      { id: 'copper', count: 1 },
    ],
  },
  {
    id: 'sword',
    output: 'sword',
    count: 1,
    ingredients: [
      { id: 'log', count: 1 },
      { id: 'iron', count: 1 },
    ],
  },
  {
    id: 'iron_chest',
    output: 'iron_chest',
    count: 1,
    ingredients: [{ id: 'iron', count: 3 }],
  },
  {
    id: 'iron_legs',
    output: 'iron_legs',
    count: 1,
    ingredients: [{ id: 'iron', count: 2 }],
  },
];

export function getRecipe(id) {
  return RECIPES.find((r) => r.id === id) ?? null;
}
