/** Exact manifest/trajectory validation. Frozen surface counts remain in the CLI owner. */
export function validateAgentToolFaceUsecases(manifest, published) {
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!Array.isArray(manifest.canonicalVerbs) || !Array.isArray(manifest.cases)) return [...errors, "canonicalVerbs and cases must be arrays"];
  const declared = new Set(published);
  const expected = new Set(manifest.canonicalVerbs);
  if (declared.size !== published.length) errors.push("internal profile publishes a duplicate name");
  if (expected.size !== manifest.canonicalVerbs.length) errors.push("manifest has a duplicate canonical verb");
  for (const verb of expected) if (!declared.has(verb)) errors.push(`manifest verb is not published on the internal profile: ${verb}`);
  for (const verb of declared) if (!expected.has(verb)) errors.push(`published verb missing from manifest: ${verb}`);
  const caseIds = new Set();
  const covered = new Set();
  for (const entry of manifest.cases) {
    if (caseIds.has(entry.id)) errors.push(`duplicate case id: ${entry.id}`);
    caseIds.add(entry.id);
    if (!expected.has(entry.firstTool)) errors.push(`${entry.id}: firstTool is not canonical: ${entry.firstTool}`);
    if (!Array.isArray(entry.tools) || entry.tools.length === 0) errors.push(`${entry.id}: tools must list the full semantic trajectory`);
    else {
      if (entry.tools[0] !== entry.firstTool) errors.push(`${entry.id}: firstTool must start the trajectory`);
      for (const tool of entry.tools) {
        covered.add(tool);
        if (!expected.has(tool)) errors.push(`${entry.id}: trajectory names an unknown verb: ${tool}`);
      }
      if (entry.offline && (!declared.has(entry.offline.operation) || !entry.tools.includes(entry.offline.operation))) {
        errors.push(`${entry.id}: offline operation is not a published trajectory tool: ${entry.offline.operation}`);
      }
    }
    if (!Array.isArray(entry.proof) || entry.proof.length < 2) errors.push(`${entry.id}: proof must contain trajectory and one result dimension`);
  }
  for (const verb of expected) if (!covered.has(verb)) errors.push(`canonical verb has no user case: ${verb}`);
  if (manifest.cases.length < 20) errors.push(`at least 20 user cases required, got ${manifest.cases.length}`);
  return errors;
}
