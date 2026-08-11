import { Item35E } from '../item/entity.js'
import { Roll35e } from '../roll.js'
import {
	TreasureTable,
	GemsTable,
	ArtsTable,
	MagicItemTable,
	MundaneItemsTable,
	weaponsTable,
	meleeWeaponsAbilityTable,
	rangedWeaponsAbilityTable,
} from './treasureTables.js'
import {ItemConsumableConverter} from "../item/converters/consumable.js";

//#region utility functions
function log(message) {
	if (CONFIG.debug['treasure-gen']) {
		// eslint-disable-next-line no-console
		//game.D35E.logger.log(message)
	}
}

function cleanObj(obj) {
	Object.keys(obj).forEach((key) => {
		if (obj[key] && typeof obj[key] === 'object') {
			cleanObj(obj[key])
		} else if (obj[key] === undefined) {
			delete obj[key]
		}
	})
	return obj
}

function execFunctions(obj) {
	for (let key in obj) {
		if (typeof obj[key] === 'object') {
			execFunctions(obj[key])
		} else if (typeof obj[key] === 'function') {
			obj[key] = obj[key]()
		}
	}
}

function times(x) {
	return [...Array(x).keys()]
}

function linkToUuid(link) {
	if (!link) return null
	if (link.startsWith('warcraftrpg2e')) {
		// Convert D35E.<pack>.<id> to the uuid - Compendium.warcraftrpg2e.<pack>.Items.<id>
		const parts = link.split('.')
		const pack = parts[1]
		const id = parts[2]
		return `Compendium.warcraftrpg2e.${pack}.Item.${id}`;

	}
	if (link.split('.').length === 1) {
		// Convert <id> to the uuid - Item.<id>
		return `Item.${link}`;
	}
	if (link.split('.').length > 2) {
		return null
	}
	return link
}

async function getItem(link) {
	if (!link) return null

	// Target 1 - Compendium Link
	if (link.includes('.')) {
		const uuid = linkToUuid(link)
		if (!uuid) return null
		return fromUuid(uuid)
	}

	// Target 2 - Item Link
	return link ? game.items.get(link) : null
}

async function rollDice(formula, enable3DDice = false) {
	let roll = await new Roll35e(formula).evaluate()
	if (enable3DDice) {
		game.enable3DDice.showForRoll(roll)
	}
	return roll.total
}

async function rollMoney(rollFormula, enable3DDice = false) {
	return rollDice(rollFormula, enable3DDice)
}

//#endregion

//TODO enable3DDice for the memes game.enable3DDice.showForRoll(roll)
export default class TreasureGenerator {
	constructor() {
		this._treasure = {
			cp: 0,
			sp: 0,
			gp: 0,
			pp: 0,
			items: [],
		}
		this._treasureErr = {
			cp: 0,
			sp: 0,
			gp: 0,
			pp: 0,
			items: [],
		}
		this._rolls = []
	}

	get treasure() {
		return this._treasure
	}

	toChat(treasure = this._treasure) {
		var TreasureString = '<div class="D35E chat-card item-card">'
		//#region gold section
		if (treasure.cp + treasure.sp + treasure.gp + treasure.pp > 0) {
			TreasureString += `<header class="card-header flexrow">
	<img src="systems/warcraftrpg2e/icons/items/inventory/Loot_129.png" title="Money" width="36" height="36">
	<h3 class="item-name">Money</h3>
	</header> <div><p>`
			if (treasure.cp > 0) {
				TreasureString +=
					'<span class="fontstyle0">cp: ' +
					treasure.cp +
					'</span><br>'
			}
			if (treasure.sp > 0) {
				TreasureString +=
					'<span class="fontstyle0">sp: ' +
					treasure.sp +
					'</span><br>'
			}
			if (treasure.gp > 0) {
				TreasureString +=
					'<span class="fontstyle0">gp: ' +
					treasure.gp +
					'</span><br>'
			}
			if (treasure.pp > 0) {
				TreasureString +=
					'<span class="fontstyle0">pp: ' + treasure.pp + '<br>'
			}

			TreasureString +=
				'</p></div><hr><span class="fontstyle0"> total value = ' +
				Math.floor(
					treasure.cp / 100 +
						treasure.sp / 10 +
						treasure.gp +
						treasure.pp * 10
				) +
				' gp</span>'
		}
		//#endregion

		//#region items section
		if (treasure.items.length > 0) {
			TreasureString += `<header class="card-header flexrow">
	<img src="systems/warcraftrpg2e/icons/items/inventory/Loot_102.png" title="Items" width="36" height="36">
	<h3 class="item-name">Items</h3>
	</header> <div class="card-content"><p>`

			treasure.items.forEach((item) => {
				TreasureString += `<span class="fontstyle0">${
					(item.amount > 1 && item.amount + 'x ') || ''
				}${item.type} ${
					(item.enhancement > 0 && '+' + item.enhancement) || ''
				} `
				if (item.ability.length > 0) {
					TreasureString += `[${item.ability
						.map((it) => it.itemType)
						.join(', ')}]`
				}
				TreasureString += ` (${item.value} gp) </span><br style="font-style:normal;font-variant:normal;font-weight:normal;letter-spacing:normal;line-height:normal;orphans:2;text-align:-webkit-auto;text-indent:0px;text-transform:none;white-space:normal;widows:2;word-spacing:0px;-webkit-text-size-adjust:auto;-webkit-text-stroke-width:0px"><br>`
			})
			TreasureString += '</p></div>'
		}
		//#endregion
		TreasureString += '</div>'
		ChatMessage.create({ content: TreasureString })
	}

	async _makeItem(item) {
		if (item.id) {
			try {
				// //game.D35E.logger.log("fetchin " + item.id);
				const _compendiumItem = await getItem(item.id)
				let _it = (_compendiumItem).toObject(false)
				delete _it._id;
				let it = new CONFIG.Item.documentClass(_it, {temporary: true})
				// //game.D35E.logger.log(it);
				if (item.consumableType) {
					//TODO handle caster Level, not every item has it defined, others have it at 0 when not needed (been added automatically)
					await it.updateSource({'system.quantity':item.amount})
					if (item.itemOverride) {
						execFunctions(item.itemOverride)	
						await it.updateSource({...item.itemOverride})
					}
					let consumableItem = await ItemConsumableConverter.toConsumable(
						it.toObject(false),
						item.consumableType
					)
					consumableItem = new CONFIG.Item.documentClass(consumableItem, {temporary: true})
					delete consumableItem._id
					return consumableItem.toObject()
				} else if (item.ability.length > 0 || item.enhancement > 0) {
					let enhancements = []

					if (item.ability.length > 0) {
						for (let itemAbility of item.ability) {
							enhancements.push({
								id: itemAbility.id,
								enhancement: itemAbility.enhancementLevel,
							})
						}
					}

					if (item.enhancement > 0) {
						if (item.id.includes('armors-and-shields')) {
							enhancements.push({
								id: 'iOhtLsgtgmt2l9CM',
								enhancement: item.enhancement,
							})
						} else {
							enhancements.push({
								id: 'Ng5AlRupmkMOgqQi',
								enhancement: item.enhancement,
							})
						}
					}

					let _enhancements = it.system.enhancements || {}
					let _enhancementsItems =
						_enhancements.items || []
					for (let enhancement of enhancements) {
						let enhancementData = await it.enhancements.addEnhancementFromCompendium(
							'warcraftrpg2e.enhancements',
							enhancement.id,
							enhancement.enhancement
						)
						_enhancementsItems.push(
							enhancementData['system.enhancements.items'].splice(
								-1
							)[0]
						)
					}

					await it.updateSource({'system.enhancements':_enhancements, 'system.quantity':item.amount})
					if (item.itemOverride) {
						execFunctions(item.itemOverride)	
						await it.updateSource({...item.itemOverride})
					}
					let _createdItem =it.toObject()
					

					return _createdItem
				} else {
					await it.updateSource({'system.quantity':item.amount})
					if (item.itemOverride) {
						execFunctions(item.itemOverride)						
						await it.updateSource({...item.itemOverride})
					}
					return it.toObject()
				}
			} catch (err) {
				game.D35E.logger.error(`TREASURE | error fetching item ${item.type} - ${item.id}`)
				game.D35E.logger.error(err)
				game.D35E.logger.error(this._rolls)
				this._treasureErr.items.push(item)
			}
		} else {
			game.D35E.logger.error(`TREASURE | no item generated for ${item.type}`)
			this._treasureErr.items.push(item)
		}
	}

	// toItemPfArr() {
	//   let promises = [];

	//   //game.D35E.logger.log(this._treasure.items)
	//   for (let item of this._treasure.items) {
	//     promises.push(this._makeItem(item));
	//   }

	//   return Promise.all(promises);
	// }

	async *toItemPfArr() {
		for (let item of this._treasure.items) {
			yield await this._makeItem(item)
		}
	}

	// toPuSContainer(position = { gridX: 0, gridY: 0 }) {
	//   let pikUpStiXModule = game.modules.get("pick-up-stix");
	//   var treasureErr = {
	//     cp: 0,
	//     sp: 0,
	//     gp: 0,
	//     pp: 0,
	//     gems: [],
	//     arts: [],
	//     items: [],
	//   };

	//   this.toItemPfArr()
	//     .then((itemsObjects) => {
	//       pikUpStiXModule.apis.makeContainer(
	//         itemsObjects.filter((el) => el !== undefined),
	//         {
	//           cp: this._treasure.cp,
	//           sp: this._treasure.sp,
	//           gp: this._treasure.gp,
	//           pp: this._treasure.pp,
	//         },
	//         position
	//       );
	//     })
	//     .then(() => {
	//       if (treasureErr.items.length > 0) {
	//         this.treasureToChat(this._treasureErr);
	//       }
	//     });
	// }

	async rollItem(
		table,
		grade,
		prefix = '',
		forceRolls = [],
		options,
		itemDamageType = []
	) {
		let magicItemRoll = await rollDice('1d100', options.enable3DDice)
		if (forceRolls && forceRolls.length > 0) {
			magicItemRoll = forceRolls.shift()
		}

		let magicItemData = table.find(
			(r) =>
				r[grade + 'Min'] <= magicItemRoll &&
				r[grade + 'Max'] >= magicItemRoll
		)
		if (magicItemData === undefined) {
			//fallback for a table withoud minor-medium-major distinction
			magicItemData = table.find(
				(r) => r['Min'] <= magicItemRoll && r['Max'] >= magicItemRoll
			)
		} else {
			prefix = ''
		}

		this._rolls.push({
			roll: magicItemRoll,
			itemType: magicItemData?.itemType || 'undefined',
		})

		// console.debug(
		//   "magicItemRoll: " + magicItemRoll + " " + magicItemData.itemType
		// );
		let result = {
			value: 0,
			enhancement: 0,
			type: '',
			ability: [],
			valueBonus: 0,
		}
		let roll = {}
		let abilities = []
		try {
			switch (magicItemData.type) {
				case 'item':
					Object.assign(result, {
						type: (
							(prefix || '') +
							' ' +
							(magicItemData.itemType || '')
						).trim(),
						value: magicItemData.value || 0,
						table: magicItemData.table,
						id: magicItemData.id,
						itemOverride: magicItemData.itemOverride,
						amount: magicItemData.amount,
						consumableType: magicItemData.consumableType,
						casterLevel: magicItemData.casterLevel,
						damageType: magicItemData.damageType,
					})
					if (magicItemData.roll && magicItemData.roll !== '1d1') {
						let ItemAmount = await rollDice(
							magicItemData.roll,
							options.enable3DDice
						)
						if (forceRolls && forceRolls.length > 0) {
							ItemAmount = forceRolls.shift()
						}
						result.amount = ItemAmount
					}
					if (magicItemData.valueRoll) {
						Object.assign(result, {
							value:
								result.value +
								await rollDice(
									magicItemData.valueRoll,
									options.enable3DDice
								),
						})
					}
					return result
				case 'roll':
					roll = await this.rollItem(
						magicItemData.table,
						grade,
						(
							(prefix || '') +
							' ' +
							(magicItemData.itemType || '')
						).trim(),
						forceRolls,
						options
					)
					Object.assign(result, roll)
					let valueBonus = 0
					if (roll.valueBonus && roll.valueBonus > 0) {
						valueBonus =
							(Math.pow(roll.enhancement + roll.valueBonus, 2) -
								Math.pow(roll.enhancement, 2)) *
							1000
						if (magicItemData.itemType === 'Weapons') {
							valueBonus *= 2
						}
					}

					if (magicItemData.valueRoll) {
						Object.assign(result, {
							value:
								result.value +
								await rollDice(
									magicItemData.valueRoll,
									options.enable3DDice
								),
						})
					}

					Object.assign(result, {
						value:
							result.value +
							(magicItemData.value || 0) +
							valueBonus,
						enhancement:
							result.enhancement ||
							0 + magicItemData.enhancement ||
							0,
					})
					let extraOverride = {
						system: {
							identified: options.identified,
							price: result.value,
							masterwork: options.masterwork,
						},
					}

					if (result.itemOverride) {
						foundry.utils.mergeObject(result.itemOverride, extraOverride)
					} else {
						result.itemOverride = extraOverride
					}

					if (options.overrideNames) {
						foundry.utils.mergeObject(result.itemOverride, {
							system: {
								identifiedName: result.type,
							},
						})
					}

					if (magicItemData.itemOverride) {
						foundry.utils.mergeObject(
							result.itemOverride,
							magicItemData.itemOverride
						)
					}

					if (magicItemData.casterLevel) {
						Object.assign(result, {
							casterLevel: magicItemData.casterLevel,
						})
					}

					return cleanObj(result)
				case 'ammunition':
					await this.rollItem(
						magicItemData.table,
						grade,
						prefix,
						forceRolls,
						options
					)
					return this.rollItem(
						table,
						grade,
						prefix,
						forceRolls,
						options
					)
				case 'extraItem':
					let extraItem = {
						value: magicItemData.value,
						type: (
							(prefix || '') +
							' ' +
							(magicItemData.itemType || '')
						).trim(),
						amount: await rollDice(
							magicItemData.roll,
							options.enable3DDice
						),
						ability: [],
						enhancement: 0,
						id: magicItemData.id,
					}
					extraItem.itemOverride = {
						system: {
							price: Math.floor(
								extraItem.value / extraItem.amount
							),
							masterwork: options.masterwork,
						},
					}
					this._treasure.items.push(extraItem)
					break
				case 'rollScroll':
					let amountFormula = ''
					switch (grade) {
						case 'minor':
							amountFormula = '1d3'
							break
						case 'medium':
							amountFormula = '1d4'
							break
						case 'major':
							amountFormula = '1d6'
							break
					}
					let scrollAmountRoll = await rollDice(
						amountFormula,
						options.enable3DDice
					)
					if (forceRolls && forceRolls.length > 0) {
						scrollAmountRoll = forceRolls.shift()
					}

					for (const step of times(scrollAmountRoll)) {
						let result2 = {
							value: 0,
							enhancement: 0,
							type: '',
							ability: [],
							valueBonus: 0,
						}
						roll = await this.rollItem(
							magicItemData.table,
							grade,
							(
								(prefix || '') +
								' ' +
								(magicItemData.itemType || '')
							).trim(),
							forceRolls,
							options
						)
						Object.assign(result2, roll)

						if (step === 0) {
							result = cleanObj(result2)
						} else {
							this._treasure.items.push(cleanObj(result2))
						}
					}
					return result
				case 'roll+':
					//item roll
					roll = await this.rollItem(
						table,
						grade,
						prefix,
						forceRolls,
						options
					)

					//ability roll
					let abilityRoll = await this.rollItem(
						roll.table,
						grade,
						'',
						forceRolls,
						options,
						roll.damageType
					)

					for (let ability of abilityRoll) {
						if (
							roll.ability.filter(
								(ab) => ab.itemType === ability.itemType
							).length === 0
						) {
							Object.assign(result, {
								value: result.value + ability.value,
								valueBonus:
									result.valueBonus + ability.enhancement,
							})
							abilities.push(ability)
						}
					}

					Object.assign(result, {
						value: result.value + roll.value,
						enhancement: result.enhancement + roll.enhancement,
						valueBonus: result.valueBonus + roll.valueBonus,
						type: ((prefix || '') + ' ' + (roll.type || '')).trim(),
						ability: JSON.parse(
							JSON.stringify(abilities.concat(roll.ability))
						),
						table: roll.table,
						id: roll.id,
						itemOverride: roll.itemOverride,
						amount: roll.amount,
					})

					return cleanObj(result)
				case 'ability++':
					roll = await this.rollItem(
						table,
						grade,
						prefix,
						forceRolls,
						options,
						itemDamageType
					)

					for (let ability of roll) {
						if (
							abilities.filter(
								(ab) => ab.itemType === ability.itemType
							).length === 0
						) {
							abilities.push(ability)
						}
					}

					roll = await this.rollItem(
						table,
						grade,
						prefix,
						forceRolls,
						options,
						itemDamageType
					)

					for (let ability of roll) {
						if (
							abilities.filter(
								(ab) => ab.itemType === ability.itemType
							).length === 0
						) {
							abilities.push(ability)
						}
					}
					return abilities
				case 'ability':
					let ret = {
						itemType: magicItemData.itemType,
						type: magicItemData.type,
						value: magicItemData.value,
						enhancement: magicItemData.enhancement,
						id: magicItemData.id,
						enhancementLevel: magicItemData.enhancementLevel,
						itemOverride: magicItemData.itemOverride,
					}

					if (magicItemData.table) {
						let {
							itemTypeExtra,
							idOverride,
							itemOverride,
						} = await this.rollItem(
							magicItemData.table,
							grade,
							prefix,
							forceRolls,
							options
						)
						ret.itemType += ', ' + itemTypeExtra
						ret.id = idOverride
						ret.itemOverride = itemOverride //might be an issue if there were case in which both ability and extraItemDef(only used for typing bane ability) use it
					}

					if (
						magicItemData.damageTypeWhitelist &&
						itemDamageType.length > 0 &&
						magicItemData.damageTypeWhitelist.length > 0
					) {
						let allowed = false
						itemDamageType.forEach((dt) => {
							if (
								magicItemData.damageTypeWhitelist.includes(dt)
							) {
								allowed = true
							}
						})
						if (!allowed) {
							return this.rollItem(
								table,
								grade,
								prefix,
								forceRolls,
								options,
								itemDamageType
							)
						}
					}

					abilities.push(ret)
					return abilities
				case 'extraItemDef':
					return {
						itemTypeExtra: magicItemData.itemType,
						idOverride: magicItemData.id,
						itemOverride: magicItemData.itemOverride,
					}
			}
		} catch (err) {
			// game.D35E.logger.error(magicItemData)
			err.message += ' ' + magicItemRoll
			throw err
		}
	}

	/**
	 *
	 * @param {Array} TreasureLevels Represents the monsters against which to run the generation algorithm e.g. [{
		cr = 1,
		moneyMultiplier = 1,
		goodsMultiplier = 1,
		itemsMultiplier = 1,
	}]
	 * @param {Object} Options e.g. { identified = false, tradeGoodsToGold = false, overrideNames = true, enable3DDice = false },
	 `identified` specifies wether magic items creted should be marked as identified by default, `tradeGoodsToGold` specifies
	 wether to make items for trade goods or directly add their gold value to the treasure, `overrideNames` specifies wether
	 to override the final item name with the name obtained from the tables (some items require it such as *Necklace of fireballs type II*
	 where the compendium item is *Necklace of fireballs* but there are 7 types), `enable3DDice` enables visual dice for the memes
	 * @param {Array} ItemRollFudge Overrides rolls maintaining array order, used for automated testing e.g. [1,5,5]
	 */
	async makeTreasureFromCR(
		TreasureLevels,
		{
			identified = false,
			tradeGoodsToGold = false,
			overrideNames = true,
			enable3DDice = false,
		},
		ItemRollFudge = []
	) {
		for (const TreasureLevel of TreasureLevels) {
			let treasureRow =
				TreasureTable[
					Math.min(Math.max(Math.floor(TreasureLevel.cr), 1), 30) - 1
				]

			//#region Roll for money
			for (const _ of times(TreasureLevel.moneyMultiplier)) {
				let moneyRoll = await rollDice('1d100', enable3DDice)
				let moneyResult = treasureRow.money.find(
					(r) => r.Min <= moneyRoll && r.Max >= moneyRoll
				)

				if (moneyResult.type !== 'nothing') {
					this.treasure[moneyResult.type] += await rollMoney(
						moneyResult.roll,
						enable3DDice
					)
				}
			}
			//#endregion

			//#region Roll for items
			for (const _ of times(TreasureLevel.itemsMultiplier)) {
				let itemsRoll = await rollDice('1d100', enable3DDice)
				if (ItemRollFudge.length > 0) {
					itemsRoll = ItemRollFudge.shift()
					// console.debug("fudged Dice roll = " + itemsRoll);
				}
				let itemsResult = treasureRow.items.find(
					(r) => r.Min <= itemsRoll && r.Max >= itemsRoll
				)
				let itemsNo = await rollDice(itemsResult.roll, enable3DDice)
				for (const _ of times(itemsNo)) {
					switch (itemsResult.type) {
						case 'nothing':
							break
						case 'mundane':
							try {
								this._addItem({
									...await this.rollItem(
										MundaneItemsTable,
										itemsResult.type,
										'',
										ItemRollFudge,
										{
											identified: true,
											overrideNames: overrideNames,
										}
									),
									ability: [],
									enhancement: 0,
								})
							} catch (err) {
								err.message +=
									' --- ' + JSON.stringify(this._rolls)
								game.D35E.logger.error(this._rolls)
								throw err
							}
							break
						case 'minor':
						case 'medium':
						case 'major':
							try {
								this._addItem(
									await this.rollItem(
										MagicItemTable,
										itemsResult.type,
										'',
										ItemRollFudge,
										{
											identified: identified,
											// TODO are potions rings etc ok to be masterwork as well?
											masterwork: true,
											overrideNames: overrideNames,
										}
									)
								)
							} catch (err) {
								err.message +=
									' --- ' + JSON.stringify(this._rolls)
								game.D35E.logger.error(this._rolls)
								throw err
							}

							break
					}
				}
			}

			if (treasureRow.extraItems) {
				let extraItemsNo = treasureRow.extraItems
				for (const _ of times(extraItemsNo)) {
					try {
						this._addItem(
							await this.rollItem(
								MagicItemTable,
								'major',
								'',
								ItemRollFudge,
								{
									identified: identified,
									// TODO are potions rings etc ok to be masterwork as well?
									masterwork: true,
									overrideNames: overrideNames,
								}
							)
						)
					} catch (err) {
						err.message += ' --- ' + JSON.stringify(this._rolls)
						game.D35E.logger.error(this._rolls)
						throw err
					}
				}
			}
			//#endregion

			//#region Roll for goods
			for (const _ of times(TreasureLevel.goodsMultiplier)) {
				let goodsRoll = await rollDice('1d100', enable3DDice)
				let goodsResult = treasureRow.goods.find(
					(r) => r.Min <= goodsRoll && r.Max >= goodsRoll
				)
				let goodsNo = await rollDice(goodsResult.roll, enable3DDice)
				for (const _ of times(goodsNo)) {
					let goods = null
					switch (goodsResult.type) {
						case 'nothing':
							break
						case 'gems':
							goods = {
								...await this.rollItem(GemsTable, 'mundane', '', [], {
									identified: true,
									overrideNames: overrideNames,
								}),
								ability: [],
								enhancement: 0,
							}
							break
						case 'arts':
							goods = {
								...await this.rollItem(ArtsTable, 'mundane', '', [], {
									identified: true,
									overrideNames: overrideNames,
								}),
								ability: [],
								enhancement: 0,
							}
							break
					}
					if (goodsResult.type !== 'nothing') {
						if (tradeGoodsToGold) {
							this.treasure.gp += goods.value
						} else {
							this._addItem(goods)
						}
					}
				}
			}
			//#endregion
		}
		log(this.treasure)
		return this
	}

	_addItem(obj) {
		this.treasure.items.push(
			cleanObj({
				value: obj.value,
				type: obj.type,
				ability: obj.ability,
				enhancement: obj.enhancement,
				amount: obj.amount || 1,
				id: obj.id,
				itemOverride: obj.itemOverride,
				consumableType: obj.consumableType,
				casterLevel: obj.casterLevel,
			})
		)
	}

	async genItems(
		noItems,
		table,
		itemType,
		prefixedRolls,
		options = {
			identified: true,
			masterwork: false,
			overrideNames: true,
		}
	) {
		for (const _ of times(noItems)) {
			this._addItem({
				ability: [],
				enhancement: 0,
				...await this.rollItem(
					table,
					itemType,
					'',
					JSON.parse(JSON.stringify(prefixedRolls)),
					options
				),
			})
		}
	}
}

//#region example

function getActorCrAndMultiplier(actor) {
	const cr = actor.system.details.cr;
	const treasure = actor.system.details?.treasure ?? {};
	const toMultiplier = (pct) => {
		const p = pct ?? 100;
		const full = Math.floor(p / 100);
		const remainder = (p % 100) / 100;
		return full + (remainder > 0 && Math.random() < remainder ? 1 : 0);
	};
	return {
		cr,
		moneyMultiplier: toMultiplier(treasure.coins),
		goodsMultiplier: toMultiplier(treasure.goods),
		itemsMultiplier: toMultiplier(treasure.items),
	};
}

function getSelectedNpcs() {
	return canvas.tokens.controlled.filter(
		(t) => game.actors.get(t.document.actorId)?.type === 'npc'
	)
}

/**
 * Treasure Generator Usage Example.
 * @param {Object} options e.g. { identified = false, tradeGoodsToGold = false, overrideNames = true }
 */
export async function genTreasureFromSelectedNpcsCr(
	options = {
		identified: false,
		tradeGoodsToGold: false,
		overrideNames: true,
	}
) {
	if (getSelectedNpcs().length !== 0) {
		let TreasureLevels = []
		getSelectedNpcs().forEach((t) => {
			let actor = game.actors.get(t.document.actorId)
			let TreasureLevel = getActorCrAndMultiplier(actor)
			TreasureLevels.push(TreasureLevel)
		})
		let treasureGen = new TreasureGenerator()
		let treasure = (await treasureGen.makeTreasureFromCR(TreasureLevels, options))
			.treasure

		let pikUpStiXModule = game.modules.get('pick-up-stix')

		if (pikUpStiXModule?.active) {
			let treasurePosition = {
			gridX: getSelectedNpcs()[0].document.x,
			gridY:
				getSelectedNpcs()[0].document.y -
					getSelectedNpcs()[0].scene.grid.size,
			}
			treasureGen.toPuSContainer(treasurePosition)
		} else {
			treasureGen.toChat()
		}
		return treasure
	}
}

export async function genTreasureFromToken(
	token,
	options = {
		identified: false,
		tradeGoodsToGold: false,
		overrideNames: true,
	}
) {
	// //game.D35E.logger.log("generating treasure for: ", token.name);
	let TreasureLevels = []
	let actor = token.actor
	let TreasureLevel = getActorCrAndMultiplier(actor)
	TreasureLevels.push(TreasureLevel)
	let treasureGen = new TreasureGenerator()
	let treasure = (await treasureGen.makeTreasureFromCR(TreasureLevels, options))
		.treasure

	// debug purposes
	// treasureGen.toChat();

	if (actor.hasPlayerOwner) {
		return
	}

	//restore original npc items items
	let itemsToDelete = token.actor.items
		.filter(
			(item) =>
				!game.actors
					.get(token.actor.id)
					.items.map((it) => it.id)
					.includes(item.id)
		)
		.map((it) => it.id)
	//game.D35E.logger.log(' Layer TOKEN', token)
	await token.actor.deleteEmbeddedDocuments(
		'Item',
		Array.from(itemsToDelete),
		{ stopUpdates: true }
	)

	// //game.D35E.logger.log("actor:", game.actors.get(token.data.actorId));
	// //game.D35E.logger.log("items:", game.actors.get(token.data.actorId).data.items);

	//TODO adding items to actor, verify 0.8 compatibility


	let itemsToCreate = []
    for await (let it of treasureGen.toItemPfArr()) {
      if (it === null || it === undefined) continue;
      //game.D35E.logger.log("item: ", item);
      itemsToCreate.push(it);
      
    }
    let createdItems = await canvas.tokens
        .get(token.id)
        .actor.createEmbeddedDocuments("Item", itemsToCreate, { stopUpdates: true });
    for (let item of createdItems) {
      if (item.type === "weapon" || item.type === "equipment") {
        await item.enhancements.updateBaseItemName(true)
      }
    }

	await canvas.tokens.get(token.document?.id ?? token.id).actor.update({
		'system.currency': {
			pp: treasure.pp,
			gp: treasure.gp,
			sp: treasure.sp,
			cp: treasure.cp,
		},
	})

	// //game.D35E.logger.log("token after treasure gen:", canvas.tokens.get(token.data._id));
	// //game.D35E.logger.log("treasure rolls:", treasureGen._rolls);
	return treasure
}

/**
 * Example for generating vendor merchandise, pass vendor and amount of items to generate,
 * it is incomplete, it's missing adding items to vendor inventory.
 * @param {Token} vendorToken
 * @param {int} noMundaneItems
 * @param {int} noMinorItems
 * @param {int} noMediumItems
 * @param {int} noMajorItems
 */
export function genWeaponSmithItems(
	vendorToken,
	noMundaneItems,
	noMinorItems,
	noMediumItems,
	noMajorItems
) {
	let treasureGen = new TreasureGenerator()

	treasureGen.genItems(noMundaneItems, MundaneItemsTable, 'mundane', [51])

	treasureGen.genItems(noMinorItems, weaponsTable, 'minor', [], {
		identified: true,
		masterwork: true,
		overrideNames: true,
	})

	treasureGen.genItems(noMediumItems, weaponsTable, 'medium', [], {
		identified: true,
		masterwork: true,
		overrideNames: true,
	})

	treasureGen.genItems(noMajorItems, weaponsTable, 'major', [], {
		identified: true,
		masterwork: true,
		overrideNames: true,
	})

	treasureGen
		.toItemPfArr()
		// eslint-disable-next-line no-unused-vars
		.then((items) => {
			//TODO add items to vendorToken
			vendorToken
		})
		.catch((err) => {
			throw err
		})
}

//#endregion
