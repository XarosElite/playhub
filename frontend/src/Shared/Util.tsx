import { Image } from "@mantine/core";
import { GameType } from "../Api/GameServer";

import minecraftLogo from '/minecraft_icon.svg';
import palworldLogo from '/palworld_icon.png';

/**
 * Map of Game Icons to display
 */
export const gameIconFact = (size: string): Map<string, JSX.Element>  => new Map([
    [String(GameType.MINECRAFT), <Image w={size} h={size} src={minecraftLogo} />],
    [String(GameType.PALWORLD), <Image w={size} h={size} src={palworldLogo} />]
]);