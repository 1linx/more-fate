export class MoreFateSkillModel extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.HTMLField({ required: true, blank: true, initial: "" }),
      overcome:    new fields.HTMLField({ required: true, blank: true, initial: "" }),
      caa:         new fields.HTMLField({ required: true, blank: true, initial: "" }),
      attack:      new fields.HTMLField({ required: true, blank: true, initial: "" }),
      defend:      new fields.HTMLField({ required: true, blank: true, initial: "" }),
    };
  }
}
