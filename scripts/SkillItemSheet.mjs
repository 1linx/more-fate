export class MoreFateSkillSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes:        ["more-fate-skill", "sheet", "item"],
      template:       "modules/more-fate/templates/skill-item-sheet.html",
      width:          620,
      height:         620,
      submitOnChange: true,
      closeOnSubmit:  false,
    });
  }

  async getData() {
    const context = await super.getData();
    // Use the serialised plain object so template helpers work reliably
    const itemData = this.item.toObject();
    context.data   = itemData;
    context.system = itemData.system;
    return context;
  }
}
