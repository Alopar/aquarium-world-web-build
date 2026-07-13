import { getStackDef } from '../items/stack.js';
import { RECIPES } from '../items/recipes.js';

/**
 * Crafting overlay: recipe list (not a Minecraft grid).
 * Toggle with C; Esc closes. Mutually exclusive with inventory panel.
 */
export class CraftingPanel {
  constructor(rootEl, { playerController = null, blockInteraction = null, inventoryPanel = null } = {}) {
    this.root = rootEl;
    this.playerController = playerController;
    this.blockInteraction = blockInteraction;
    this.inventoryPanel = inventoryPanel;
    this.inventory = null;
    this.open = false;
    this.unsub = null;
    this.recipeEls = [];

    this.onKeyDown = this.onKeyDown.bind(this);
    this.build();
    window.addEventListener('keydown', this.onKeyDown);
  }

  setDeps({ playerController, blockInteraction, inventoryPanel }) {
    this.playerController = playerController ?? this.playerController;
    this.blockInteraction = blockInteraction ?? this.blockInteraction;
    this.inventoryPanel = inventoryPanel ?? this.inventoryPanel;
  }

  build() {
    this.root.innerHTML = '';
    this.root.classList.add('crafting-panel', 'hidden');
    this.root.setAttribute('aria-hidden', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'crafting-panel__backdrop';
    backdrop.addEventListener('click', () => this.close());

    const panel = document.createElement('div');
    panel.className = 'crafting-panel__window';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h2');
    title.className = 'crafting-panel__title';
    title.textContent = 'Крафт';

    const hint = document.createElement('p');
    hint.className = 'crafting-panel__hint';
    hint.textContent = 'Выбери рецепт · C или Esc — закрыть';

    const list = document.createElement('div');
    list.className = 'crafting-panel__list';

    this.recipeEls = [];
    for (const recipe of RECIPES) {
      const row = this.createRecipeRow(recipe);
      list.appendChild(row.el);
      this.recipeEls.push(row);
    }

    panel.append(title, hint, list);
    this.root.append(backdrop, panel);
  }

  createRecipeRow(recipe) {
    const el = document.createElement('div');
    el.className = 'crafting-panel__row';
    el.dataset.recipeId = recipe.id;

    const outDef = getStackDef(recipe.output);
    const outHex = (outDef?.color ?? 0xffffff).toString(16).padStart(6, '0');

    const result = document.createElement('div');
    result.className = 'crafting-panel__result';

    const swatch = document.createElement('span');
    swatch.className = 'crafting-panel__swatch';
    swatch.style.backgroundColor = `#${outHex}`;

    const name = document.createElement('span');
    name.className = 'crafting-panel__name';
    name.textContent = outDef?.name ?? recipe.output;

    const count = document.createElement('span');
    count.className = 'crafting-panel__out-count';
    count.textContent = recipe.count > 1 ? `×${recipe.count}` : '';

    result.append(swatch, name, count);

    const ingredients = document.createElement('div');
    ingredients.className = 'crafting-panel__ingredients';

    const ingredientEls = [];
    for (const ing of recipe.ingredients) {
      const ingDef = getStackDef(ing.id);
      const ingHex = (ingDef?.color ?? 0xffffff).toString(16).padStart(6, '0');

      const chip = document.createElement('span');
      chip.className = 'crafting-panel__ing';

      const ingSwatch = document.createElement('span');
      ingSwatch.className = 'crafting-panel__ing-swatch';
      ingSwatch.style.backgroundColor = `#${ingHex}`;

      const ingText = document.createElement('span');
      ingText.className = 'crafting-panel__ing-text';

      chip.append(ingSwatch, ingText);
      ingredients.appendChild(chip);
      ingredientEls.push({ chip, text: ingText, id: ing.id, need: ing.count, name: ingDef?.name ?? ing.id });
    }

    const craftBtn = document.createElement('button');
    craftBtn.type = 'button';
    craftBtn.className = 'crafting-panel__craft-btn';
    craftBtn.textContent = 'Скрафтить';
    craftBtn.addEventListener('click', () => this.craft(recipe));

    el.append(result, ingredients, craftBtn);
    return { el, recipe, ingredientEls, craftBtn };
  }

  bind(inventory) {
    this.inventory = inventory;
    this.unsub?.();
    this.unsub = inventory.onChange(() => this.refresh());
    this.refresh();
  }

  craft(recipe) {
    if (!this.open || !this.inventory) return;
    this.inventory.craft(recipe);
  }

  onKeyDown(e) {
    if (e.code !== 'KeyC' && e.code !== 'Escape') return;
    if (!this.inventory) return;

    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'Escape') {
      if (!this.open) return;
      e.preventDefault();
      this.close();
      return;
    }

    e.preventDefault();
    this.toggle();
  }

  toggle() {
    if (this.open) this.close();
    else this.openPanel();
  }

  setWorldHotbarVisible(visible) {
    const hotbar = document.getElementById('hotbar');
    const hint = document.getElementById('hud-hint');
    const placeMode = document.getElementById('hud-place-mode');
    const mobile = document.getElementById('mobile-controls');
    hotbar?.classList.toggle('hidden', !visible);
    hint?.classList.toggle('hidden', !visible);
    placeMode?.classList.toggle('hidden', !visible);
    mobile?.classList.toggle('mobile-controls--ui-hidden', !visible);
  }

  openPanel() {
    if (this.open || !this.inventory) return;
    if (this.inventoryPanel?.open) this.inventoryPanel.close();
    this.open = true;
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
    this.setWorldHotbarVisible(false);
    this.playerController?.unlock();
    if (this.blockInteraction) this.blockInteraction.inputBlocked = true;
    this.refresh();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
    this.setWorldHotbarVisible(true);
    if (this.blockInteraction) this.blockInteraction.inputBlocked = false;
    this.playerController?.resumeAfterUi?.();
  }

  refresh() {
    if (!this.inventory) return;

    for (const row of this.recipeEls) {
      const can = this.inventory.canCraft(row.recipe);
      row.el.classList.toggle('crafting-panel__row--ready', can);
      row.el.classList.toggle('crafting-panel__row--locked', !can);
      row.craftBtn.disabled = !can;

      for (const ing of row.ingredientEls) {
        const have = this.inventory.countItem(ing.id);
        const ok = have >= ing.need;
        ing.text.textContent = `${ing.name} ${have}/${ing.need}`;
        ing.chip.classList.toggle('crafting-panel__ing--ok', ok);
        ing.chip.classList.toggle('crafting-panel__ing--missing', !ok);
      }
    }
  }

  dispose() {
    this.unsub?.();
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
