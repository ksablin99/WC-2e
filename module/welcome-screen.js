import { createTabs } from "./lib.js";

export default function renderWelcomeScreen() {
    const system = game.system;
    const moduleId = system.id;
    const title = system.title;
    const cleanVersion = system.version.replace(/-.*$/, '');

    // Registration and version-gate are handled by D35E.js before this function is called.

    class WelcomeScreen extends Application {
        static get defaultOptions() {
            const options = super.defaultOptions;
            options.template = `systems/warcraftrpg2e/templates/welcome-screen.html`;
            options.resizable = false;
            options.width = 920;
            options.height = 730;
            options.classes = ["welcome-screen"];
            options.title = `${title} - Welcome Screen`;

            return options;
        }

        activateListeners(html) {
            super.activateListeners(html);
            const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
            const content = root?.parentElement ?? root;
            if (!content) return;
            this.createTabs(document.documentElement)
            content.querySelectorAll('.show-again').forEach(el => el.addEventListener('change', ev => {
                let val = "0.0.0";
                if (ev.currentTarget.checked)
                    val = cleanVersion;

                game.settings.set(moduleId, "version", val);
            }))
        }

        createTabs(html) {
            const __tabs = new foundry.applications.ux.Tabs({ navSelector: ".welcome-tabs", contentSelector: ".welcome-content", initial: "welcome", active: "welcome" });
            __tabs.bind(html);
        }
    }

    (new WelcomeScreen()).render(true);
}
