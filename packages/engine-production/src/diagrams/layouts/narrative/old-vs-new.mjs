// diagrams/layouts/narrative/old-vs-new.mjs — the old way against the new way.
import beforeAfter from './before-after.mjs';

export default {
  ...beforeAfter,
  name: 'old-vs-new',
  description: 'The old way against the new way, joined by a transformation arrow',
  fields: ['title', 'old', 'new'],
  validate(spec) {
    return beforeAfter.validate({ title: spec?.title, before: spec?.old, after: spec?.new });
  },
  build(spec, c, P) {
    return beforeAfter.build({ title: spec?.title, before: spec?.old, after: spec?.new }, c, P);
  },
};
