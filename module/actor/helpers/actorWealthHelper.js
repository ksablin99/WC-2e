export class ActorWealthHelper {
    static calculateCoinWeight(actorData) {
        let customCurrency = actorData.customCurrency;
        let currency = actorData.currency;
        if (actorData.system) {
            customCurrency = actorData.system.customCurrency;
            currency = actorData.system.currency;
        }
        let baseWeight = Object.values(currency).reduce((cur, amount) => {
            return cur + amount;
        }, 0) / 50;

        let currencyConfig = game.settings.get("warcraftrpg2e", "currencyConfig");
        for (let currency of currencyConfig.currency) {
            if (customCurrency)
                baseWeight += (customCurrency[currency[0]] || 0)*(currency[2] || 0)
        }

        return baseWeight;
    }
}
