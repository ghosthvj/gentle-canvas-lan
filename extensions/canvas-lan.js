import { getCapabilities, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { installCanvasLan } from '../src/extension.js';

export default function canvasLan(pi) {
  // Resolve host modules at the entry boundary, where Pi/Jiti supplies aliases.
  // A dynamic import inside a native JS dependency can bypass those aliases.
  installCanvasLan(pi, { loadUi: async () => ({ truncateToWidth, visibleWidth, hyperlinks: getCapabilities().hyperlinks === true }) });
}
