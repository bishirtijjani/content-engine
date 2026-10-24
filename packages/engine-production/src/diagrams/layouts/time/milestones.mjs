// diagrams/layouts/time/milestones.mjs — a timeline of milestones.
import timeline from './timeline.mjs';

export default {
  ...timeline,
  name: 'milestones',
  description: 'Milestones along a time axis, each with a date and status',
  fields: ['title', 'milestones', 'active'],
  validate(spec) {
    const events = (Array.isArray(spec?.milestones) ? spec.milestones : []).map((m) => ({
      date: m?.date, label: m?.label, icon: m?.icon,
    }));
    return timeline.validate({ title: spec?.title, events, active: spec?.active });
  },
  slots(spec) {
    const events = (Array.isArray(spec?.milestones) ? spec.milestones : []).map((m) => ({
      date: m?.date, label: m?.label, icon: m?.icon,
    }));
    return timeline.slots({ title: spec?.title, events, active: spec?.active });
  },
  build(spec, c, P) {
    const events = (Array.isArray(spec?.milestones) ? spec.milestones : []).map((m) => ({
      date: m?.date, label: m?.label, icon: m?.icon ?? 'flag',
    }));
    return timeline.build({ title: spec?.title, events, active: spec?.active }, c, P);
  },
};
