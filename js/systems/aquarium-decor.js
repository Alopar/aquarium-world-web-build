/**
 * Toggle aquarium glass + space skybox (world voxels stay visible).
 * @param {import('../app.js').App} app
 * @param {boolean} enabled
 */
export function applyAquariumDecorEnabled(app, enabled) {
  if (!app) return;

  const on = enabled !== false;
  const tank = app.world?.tank;
  if (tank) tank.visible = on;

  app.spaceSky?.setDecorEnabled(on);
}
