/**
 * Define a set of template paths to pre-load
 * Pre-loaded templates are compiled and cached for fast access when rendering
 * @return {Promise}
 */
export const preloadHandlebarsTemplates = async function () {
  // Define template paths to load
  const templatePaths = [
    // Actor Sheet Partials
    "systems/warcraftrpg2e/templates/actors/parts/actor-traits.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-inventory.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-features.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-spellbook-front.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-spellbook.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-deck-front.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-deck.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-skills-front.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-skills.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-defenses.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-buffs.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-attacks.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-details.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-attributes.html",
    "systems/warcraftrpg2e/templates/actors/parts/actor-config.html",
    "systems/warcraftrpg2e/templates/actors/npc-sheet-gmpart.html",

    // Item Sheet Partials
    "systems/warcraftrpg2e/templates/items/parts/item-action.html",
    "systems/warcraftrpg2e/templates/items/parts/item-links.html",
    "systems/warcraftrpg2e/templates/items/parts/item-activation.html",
    "systems/warcraftrpg2e/templates/items/parts/item-description.html",
    "systems/warcraftrpg2e/templates/items/parts/item-changes.html",
    "systems/warcraftrpg2e/templates/items/parts/item-notes.html",
    "systems/warcraftrpg2e/templates/items/parts/item-template.html",
    "systems/warcraftrpg2e/templates/items/parts/item-children.html",
    "systems/warcraftrpg2e/templates/items/parts/item-enhancement.html",
    "systems/warcraftrpg2e/templates/items/parts/item-light.html",
    "systems/warcraftrpg2e/templates/items/parts/item-customization.html",
    "systems/warcraftrpg2e/templates/items/parts/item-conditionals.html",
    "systems/warcraftrpg2e/templates/items/parts/item-senses.html",
    "systems/warcraftrpg2e/templates/items/parts/item-spellbook.html",
    "systems/warcraftrpg2e/templates/items/parts/item-spellbook-list.html",
    "systems/warcraftrpg2e/templates/items/parts/item-intelligent.html",
    "systems/warcraftrpg2e/templates/items/parts/item-intelligent-toggle.html",
    "systems/warcraftrpg2e/templates/items/components/uid-input.html",

    // Shared Components
    "systems/warcraftrpg2e/templates/components/localized-info-tooltip.html",

    // Misc
    "systems/warcraftrpg2e/templates/internal/token-config.html",

    // Apps
    "systems/warcraftrpg2e/templates/apps/attack-roll-dialog.html",
    "systems/warcraftrpg2e/templates/apps/vision-permission.html",

    // Chat
    "systems/warcraftrpg2e/templates/chat/roll-ext.html",
    "systems/warcraftrpg2e/templates/chat/defenses.html",
    "systems/warcraftrpg2e/templates/chat/turn-undead.html",

    // Internal Rendering Partials
    "systems/warcraftrpg2e/templates/internal/spell-description.html",
    "systems/warcraftrpg2e/templates/internal/consumable-description.html",
    "systems/warcraftrpg2e/templates/internal/shapechange-description.html",

    "systems/warcraftrpg2e/templates/sidebar/combat-charsheet.html",
  ];

  // Load the template parts
  return foundry.applications.handlebars.loadTemplates(templatePaths);
};
