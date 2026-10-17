import birdSvg from './bird.svg?raw';
import slaughterSvg from './slaughter.svg?raw';
import cuttingSvg from './cutting.svg?raw';
import packingSvg from './packing.svg?raw';
import coldSvg from './cold.svg?raw';
import truckSvg from './truck.svg?raw';

// Иконки узлов пути: исходные SVG дизайн-системы (viewBox 0 0 96 96, обводка currentColor, толщина 2).
export const NODE_ICON_SVG = {bird: birdSvg, slaughter: slaughterSvg, cutting: cuttingSvg, packing: packingSvg, cold: coldSvg, truck: truckSvg};

// Размер задает обертка: width и height исходного SVG заменяются на size, цвет берется из родителя через currentColor.
export function NodeIcon({name, size = 56}) {
  const svg = (NODE_ICON_SVG[name] ?? '').replace(/<svg([^>]*)>/, (_, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${size}" height="${size}">`);
  return <span className="node-icon" aria-hidden="true" style={{display: 'inline-block', width: size, height: size, lineHeight: 0, flex: 'none'}} dangerouslySetInnerHTML={{__html: svg}}/>;
}
