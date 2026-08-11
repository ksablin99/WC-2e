import { createTabs } from "./lib.js";

export default function renderWelcomeScreen() {
    const system = game.system;
    const moduleId = system.id;
    const title = system.title;
    const moduleVersion = system.version;

    class DemoScreen extends Application {
        static get defaultOptions() {
            const options = super.defaultOptions;
            options.template = `systems/warcraftrpg2e/templates/demo-screen.html`;
            options.resizable = true;
            options.width = 920;
            options.height = 680;
            options.classes = ["welcome-screen"];
            options.title = `${title} - Demo`;

            return options;
        }

        getData() {

            return {
                user: game.user,
                character: game.user.character,
            };
        }

        activateListeners(html) {
            super.activateListeners(html);
            this.createTabs(document.documentElement)
        }

        createTabs(html) {
            const __tabs = new foundry.applications.ux.Tabs({navSelector: ".welcome-tabs", contentSelector: ".welcome-content", initial: "welcome", active: "welcome"});
            __tabs.bind(html);
        }
    }

    (new DemoScreen()).render(true);
}
