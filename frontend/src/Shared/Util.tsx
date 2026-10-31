import React from "react";
import { Image } from "@mantine/core";

import minecraftLogo from '/minecraft_icon.svg';
import palworldLogo from '/palworld_icon.png';

/**
 * Map of Game Icons to display
 */
export const gameIconFact = (size: string): Map<string, JSX.Element> => new Map([
    ["minecraft", <Image w={size} h={size} src={minecraftLogo} />],
    ["palworld", <Image w={size} h={size} src={palworldLogo} />]
]);
