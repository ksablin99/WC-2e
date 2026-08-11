import { createTabs } from "./lib.js";

export default function renderOnboardingScreen() {
    const system = game.system;
    const moduleId = system.id;
    const title = "warcraftrpg2e";
    const moduleVersion = system.version;


    const onboarding = game.settings.get(title, "__onboarding") || game.settings.get(title, "__onboardingHidden");

    if (onboarding)
        return;

    class OnboardingScreen extends Application {
        static get defaultOptions() {
            const options = super.defaultOptions;
            options.template = `systems/warcraftrpg2e/templates/onboarding.html`;
            options.resizable = false;
            options.width = 600;
            options.height = 195;
            options.top = window.innerHeight - 320;
            options.classes = ["onboarding"];

            return options;
        }

        activateListeners(html) {
            super.activateListeners(html);
            const content = html[0].parentElement;
            content.querySelectorAll('.show-again').forEach(el => el.addEventListener('click', async ev => {
                await game.settings.set(title, "__onboarding", true);
                this.close()
            }))
        }

        getData(options={}) {
            const actorSidebarIcon = game.version >= 10 ? CONFIG.Actor.sidebarIcon : "fas fa-users";
            return { actorSidebarIcon };
        }
    }

    (new OnboardingScreen()).render(true);
}
