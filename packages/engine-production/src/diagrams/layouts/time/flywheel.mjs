// diagrams/layouts/time/flywheel.mjs — a cycle with a named centre.
import cycle from '../process/cycle.mjs';

export default {
  ...cycle,
  name: 'flywheel',
  description: 'A self-reinforcing loop with a named centre',
  fields: ['title', 'steps', 'center', 'active'],
};
