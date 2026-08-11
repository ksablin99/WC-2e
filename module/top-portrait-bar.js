import { DEATH_RULE_D35E, resolveDeathRule } from "./actor/helpers/warcraftDeathRules.js";

export class TopPortraitBar {

    static async clear() {
        const bar = document.getElementById('portrait-bar');
        if (bar) bar.remove();
    }

    static async renderAll() {
        TopPortraitBar.clear();
        for (let actor of game.actors) {
            TopPortraitBar.render(actor);
        }
    }

    static #removeEmptyBar(portraitBar) {
        if (portraitBar && !portraitBar.querySelector('.portrait')) portraitBar.remove();
    }

    static async render(actor) {
        let partyHudType = game.settings.get("warcraftrpg2e", "showPartyHud")
        let useTokenImages = game.settings.get("warcraftrpg2e", "showPartyHudTokenImage")
        let portraitBar = document.getElementById('portrait-bar');
        let dragging = false;
        let dragX = 0;
        let dragY = 0;

        if (!["full", "narrow", "none"].includes(partyHudType)) partyHudType = "none";
        if (partyHudType === "none") {
            if (portraitBar) portraitBar.style.display = 'none';
            return;
        }

        if (actor == null)
            return;

        let portraitDiv = document.getElementById('actor-portrait-' + actor.id);
        if (!actor.system.isPartyMember) {
            portraitDiv?.remove();
            TopPortraitBar.#removeEmptyBar(portraitBar);
            return;
        }
        if (!actor.testUserPermission(game.user, "LIMITED")) {
            portraitDiv?.remove();
            TopPortraitBar.#removeEmptyBar(portraitBar);
            return;
        }

        if (!portraitBar) {
            portraitBar = document.createElement('div');
            portraitBar.id = 'portrait-bar';
            portraitBar.className = 'portrait-bar flexcol';

            const handle = document.createElement('div');
            handle.id = 'portrait-bar-handle';
            handle.innerHTML = '<a><i class="fas fa-arrows-alt"></i></a>';
            portraitBar.appendChild(handle);

            handle.addEventListener('mousedown', (e) => {
                dragging = true;
                dragX = e.clientX - portraitBar.offsetLeft;
                dragY = e.clientY - portraitBar.offsetTop;
            });
            handle.addEventListener('mouseup', () => {
                dragging = false;
                localStorage.setItem("D35E-portraitbar-y-location", portraitBar.offsetTop);
                localStorage.setItem("D35E-portraitbar-x-location", portraitBar.offsetLeft);
            });
            handle.addEventListener('mousemove', (e) => {
                if (dragging) {
                    portraitBar.style.top = `${e.clientY - dragY}px`;
                    portraitBar.style.left = `${e.clientX - dragX}px`;
                }
            });

            document.body.appendChild(portraitBar);
        }
        portraitBar.style.display = '';

        if (!portraitDiv) {
            const imgSrc = useTokenImages ? (actor.prototypeToken?.texture?.src || actor.img) : actor.img;
            portraitDiv = document.createElement('div');
            portraitDiv.id = 'actor-portrait-' + actor.id;
            portraitDiv.className = `portrait ${partyHudType}`;
            portraitDiv.innerHTML =
                `<div class="barbox ${partyHudType}">` +
                    `<span class="name">${actor.name}</span> ` +
                    `<div class="damagebar">` +
                        `<div class="background"></div> ` +
                        `<div class="damage"></div>` +
                        `<span class="life">10/10</span>` +
                    `</div>` +
                `</div>` +
                `<div class="buffbox flexrow ${partyHudType}"></div>` +
                `<img src="${imgSrc}">` +
                `<div class="overlay"></div>`;
            portraitBar.appendChild(portraitDiv);
        }

        let posTop = localStorage.getItem("D35E-portraitbar-y-location") || 460;
        let posLeft = localStorage.getItem("D35E-portraitbar-x-location") || 20;

        portraitBar.style.top = `${posTop}px`;
        portraitBar.style.left = `${posLeft}px`;

        const buffBar = portraitDiv.querySelector('.buffbox');
        buffBar.innerHTML = '';

        let items = actor.items.filter(o => (o.type === "buff") && foundry.utils.getProperty(o, "system.active") === true).sort((a, b) => {
            return a.sort - b.sort;
        });
        const damage = portraitDiv.querySelector('.damage');
        const life = portraitDiv.querySelector('.life');
        const hpValue = actor.system.attributes.hp.value;
        const deathRule = resolveDeathRule(actor.system.attributes.deathRule, actor.race?.system?.deathRule);
        const conditions = actor.system.attributes.conditions;
        const usesLegacyThreshold = deathRule === DEATH_RULE_D35E;
        const isDead = usesLegacyThreshold ? hpValue <= -10 : conditions.dead;
        const isDying = usesLegacyThreshold ? hpValue < 0 && hpValue > -10 : conditions.dying;
        let pixelDamage = (hpValue / actor.system.attributes.hp.max) * 100;

        if (isDead) {
            pixelDamage = 0;
            portraitDiv.classList.add('dead');
            life.textContent = 'Dead';
        } else if (isDying) {
            pixelDamage = 0;
            portraitDiv.classList.add('dead');
            life.textContent = 'Dying';
        } else if (!usesLegacyThreshold && conditions.disabled) {
            pixelDamage = 0;
            portraitDiv.classList.remove('dead');
            life.textContent = 'Disabled';
        } else {
            portraitDiv.classList.remove('dead');
            if (actor.testUserPermission(game.user, "OBSERVER")) {
                life.textContent = `${hpValue} / ${actor.system.attributes.hp.max}`;
            } else {
                life.textContent = '';
            }
        }
        damage.style.width = `${pixelDamage}%`;

        let buffBarItems = "";
        items.forEach(function (item) {
            buffBarItems += `<div class="item-image tooltip" style="background-image: url('${item.img}')"><div class="tooltipcontent">${item.name}</div><div class="pretty-border"></div></div>`;
        });
        buffBar.insertAdjacentHTML('beforeend', buffBarItems);

        portraitDiv.addEventListener('click', function (event) {
            if (!actor.testUserPermission(game.user, "OBSERVER"))
                return;
            actor.sheet.render(true);
        });
    }
}
