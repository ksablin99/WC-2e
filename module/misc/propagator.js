/* theripper93
 * Copyright (C) 2021 dnd-randomizer
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * Original License:
 * https://github.com/theripper93/dnd-randomizer/blob/master/LICENSE
 */

/* WARPGATE CHANGES
 * exporting propagator class
 * removed test function from original code
 */

export class Propagator {
  // Find a non occupid cell in the grid that matches the size of the token given an origin
  static getFreePosition(tokenData, origin, collision = true) {
    origin = canvas.grid.getCenterPoint(origin);
    const positions = Propagator.generatePositions(origin);
    for (let position of positions) {
      if (Propagator.canFit(tokenData, position, positions[0], collision)) {
        return position;
      }
    }
  }
  //generate positions radiantially from the origin
  static generatePositions(origin) {
    let positions = [Propagator.getSnappedTopLeftPoint({ x: origin.x - 1, y: origin.y - 1 })];
    for (
      let r = canvas.scene.dimensions.size;
      r < canvas.scene.dimensions.size * 10;
      r += canvas.scene.dimensions.size
    ) {
      for (let theta = 0; theta < 2 * Math.PI; theta += Math.PI / ((4 * r) / canvas.scene.dimensions.size)) {
        const newPos = canvas.grid.getTopLeftPoint({x: origin.x + r * Math.cos(theta), y: origin.y + r * Math.sin(theta)});
        positions.push(newPos);
      }
    }
    return positions;
  }

  static getSnappedTopLeftPoint(point) {
    if (typeof canvas.grid.getSnappedPosition === "function") {
      return canvas.grid.getSnappedPosition(point.x, point.y);
    }
    if (typeof canvas.grid.getTopLeftPoint === "function") {
      return canvas.grid.getTopLeftPoint(point);
    }
    return point;
  }
  //check if a position is free
  static isFree(position) {
    const gridSize = canvas.scene?.dimensions?.size ?? canvas.grid?.size ?? 0;
    const sceneTokens = canvas.scene?.tokens?.contents ?? [];
    for (const token of sceneTokens) {
      const hitBox = new PIXI.Rectangle(
        token.x ?? 0,
        token.y ?? 0,
        (token.width ?? 1) * gridSize,
        (token.height ?? 1) * gridSize
      );
      if (hitBox.contains(position.x, position.y)) {
        return false;
      }
    }
    return true;
  }
  //check if a token can fit in a position
  static canFit(tokenData, position, origin, collision) {
    for (let i = 0; i < tokenData.width; i++) {
      for (let j = 0; j < tokenData.height; j++) {
        const x = position.x + j * canvas.scene.dimensions.size;
        const y = position.y + i * canvas.scene.dimensions.size;
        if (!Propagator.isFree({ x, y })) {
          return false;
        }
      }
    }
    const destination = {
      x: position.x + (tokenData.width * canvas.scene.dimensions.size) / 2,
      y: position.y + (tokenData.height * canvas.scene.dimensions.size) / 2,
    };
    const hasCollision = CONFIG.Canvas.polygonBackends.sight.testCollision(origin, destination, {
      mode: "any",
      type: "sight",
    });
    return !collision || !hasCollision;
  }
}
