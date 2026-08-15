#!/usr/bin/env python3
"""ComfyUI UI-format workflow → API-format (workflow_api.json) converter.

WHY THIS EXISTS: ComfyUI's official template pack ships every workflow in **UI
format** (nodes[]/links[] + subgraphs), never API format. But Nomi's importer
(what a user pastes) expects the **API format** that ComfyUI's "Export (API)"
menu produces. To test Nomi's analyzer against real workflows at volume, we must
first reproduce that Export-API conversion. This mirrors the frontend's
`app.graphToPrompt()` closely enough for analyzer testing:

  - drop bypassed (mode==4) and muted (mode==2) nodes
  - for each surviving node, walk its class's `input_order` (from /object_info):
      * if that input is fed by a link  → inputs[key] = [origin_node_id, slot]
      * else                            → inputs[key] = next widgets_values entry
  - recursively FLATTEN subgraph instances (type == a UUID present in
    definitions.subgraphs) into their inner nodes, re-wiring interface I/O.

Output: a map { "<nodeId>": {class_type, inputs, _meta:{title}} }, exactly the
shape parseComfyApiWorkflow expects. Emits one JSON object per input file to
stdout as {file, ok, api|error, meta}. Reads /object_info once from the live
server for input ordering.

This is a TEST HARNESS, not production code. It is deliberately conservative:
when it can't faithfully convert (unknown node class, malformed subgraph), it
records why so the report can separate "Nomi can't analyze" from "our converter
couldn't produce a faithful API graph".
"""
import json
import re
import sys
import glob
import os
import urllib.request

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
BASE = os.environ.get("COMFY_BASE", "http://127.0.0.1:8188")


def fetch_object_info():
    with urllib.request.urlopen(f"{BASE}/object_info", timeout=30) as r:
        return json.load(r)


OBJECT_INFO = fetch_object_info()


def widget_plan_for(class_type):
    """Ordered widget-input plan for a class, from /object_info.

    Returns list of (name, has_control_after_generate). Only inputs that are
    WIDGETS (INT/FLOAT/STRING/BOOLEAN/COMBO) are included, in input_order.
    This mirrors litegraph: `widgets_values` holds one entry per widget slot in
    this exact order, PLUS one extra string entry right after any widget that
    has control_after_generate (seed/noise_seed randomize|fixed|increment).

    A widget-typed input that is *also linked* (converted to input) STILL owns
    its widget slot in the array — the caller consumes the slot then overrides
    the final value with the link. Getting this alignment right is essential:
    ~30% of corpus nodes have a converted-widget input, and mis-alignment
    silently corrupts every downstream widget value (prompt text, seed, etc.).
    """
    spec = OBJECT_INFO.get(class_type)
    if not isinstance(spec, dict):
        return None
    order = spec.get("input_order") or {}
    inp = spec.get("input") or {}
    plan = []
    for group in ("required", "optional"):
        names = order.get(group)
        gdict = inp.get(group) if isinstance(inp.get(group), dict) else {}
        if not names:
            names = list(gdict.keys())
        for name in names:
            v = gdict.get(name)
            if not isinstance(v, list) or not v:
                plan.append((name, False))  # undescribed -> best-effort widget slot
                continue
            t = v[0]
            opts = v[1] if len(v) > 1 and isinstance(v[1], dict) else {}
            if isinstance(t, list):
                plan.append((name, False))  # inline COMBO list = widget
            elif isinstance(t, str) and t in ("INT", "FLOAT", "STRING", "BOOLEAN", "COLOR"):
                plan.append((name, bool(opts.get("control_after_generate"))))
            elif isinstance(t, str) and "options" in opts:
                # named COMBO / dynamic combo (COMFY_DYNAMICCOMBO_V3): widget slot.
                # NOTE: expanded dynamic combos can occupy >1 slot in widgets_values;
                # we model the primary value only, so a minority of dynamic-widget
                # nodes may mis-align downstream inputs (reported separately).
                plan.append((name, False))
            # else: connection socket (IMAGE/LATENT/MODEL/VIDEO/...) -> no widget slot
    return plan


def map_widgets(class_type, widgets_values, wired_names):
    """Return {input_name: value} for widget slots, consuming control entries.

    widgets_values: the node's saved array (or dict). wired_names: set of input
    names currently fed by a link (their widget value is still consumed for
    alignment, then discarded so the link can win downstream).
    """
    plan = widget_plan_for(class_type)
    out = {}
    if isinstance(widgets_values, dict):
        # dict form: direct name->value (rare, newer format); no control phantoms
        for name, val in widgets_values.items():
            if name not in wired_names:
                out[name] = val
        return out, plan is None
    if not isinstance(widgets_values, list):
        return out, plan is None
    if plan is None:
        return out, True  # unknown class: can't align; report it
    wi = 0
    n = len(widgets_values)
    for name, has_ctrl in plan:
        if wi >= n:
            break
        val = widgets_values[wi]
        wi += 1
        # consume the control_after_generate phantom entry that follows a seed
        if has_ctrl and wi < n and isinstance(widgets_values[wi], str) and \
                widgets_values[wi] in ("randomize", "fixed", "increment", "decrement"):
            wi += 1
        if name not in wired_names:
            out[name] = val
    return out, False


class Converter:
    def __init__(self, doc):
        self.doc = doc
        self.subgraph_defs = {}
        defs = doc.get("definitions") or {}
        for sg in (defs.get("subgraphs") or []):
            if isinstance(sg, dict) and sg.get("id"):
                self.subgraph_defs[sg["id"]] = sg
        self.notes = []
        self._uid = 0
        # global link index: link_id -> (origin_node, origin_slot)
        self.notes_unknown = set()

    def new_prefix(self):
        self._uid += 1
        return f"sg{self._uid}"

    def build_link_index(self, links):
        idx = {}
        for l in links or []:
            # link formats: [id, origin_node, origin_slot, target_node, target_slot, type]
            # or object form {id, origin_id, origin_slot, target_id, target_slot}
            if isinstance(l, list) and len(l) >= 6:
                idx[l[0]] = (l[1], l[2])
            elif isinstance(l, dict) and "id" in l:
                idx[l["id"]] = (l.get("origin_id"), l.get("origin_slot"))
        return idx

    def convert(self):
        """Top-level graph -> API dict. Raises nothing; returns (api, notes)."""
        api = {}
        self._emit_scope(
            nodes=self.doc.get("nodes") or [],
            links=self.doc.get("links") or [],
            id_prefix="",
            api=api,
            iface_link_resolver=lambda slot: None,  # top scope has no external inputs
        )
        return api, self.notes

    def _node_api_id(self, prefix, node_id):
        return f"{prefix}{node_id}" if prefix else str(node_id)

    def _emit_scope(self, nodes, links, id_prefix, api, iface_link_resolver):
        """Emit all real nodes in a scope (main graph or one subgraph instance).

        iface_link_resolver(input_slot_index) -> (api_node_id, slot) | None
        maps a subgraph's INTERFACE input slot to the outer link feeding it.
        Returns a resolver for THIS scope's outputs used by callers.
        """
        link_idx = self.build_link_index(links)
        # Map node_id -> node for this scope
        node_by_id = {n["id"]: n for n in nodes if isinstance(n, dict) and "id" in n}

        # First pass: recursively expand subgraph instances so we know how to
        # resolve links that originate from a subgraph output.
        # subgraph_output_map: (instance_node_id, output_slot) -> (api_node_id, slot)
        subgraph_output_map = {}
        subgraph_input_targets = {}  # (instance_node_id, input_slot) -> [(inner_api_id, inner_slot_name_ignored)]

        # Pre-expand subgraphs
        for n in nodes:
            if not isinstance(n, dict):
                continue
            t = n.get("type")
            if isinstance(t, str) and t in self.subgraph_defs and n.get("mode", 0) not in (2, 4):
                self._expand_subgraph_instance(
                    n, self.subgraph_defs[t], id_prefix, api,
                    outer_link_idx=link_idx, node_by_id=node_by_id,
                    subgraph_output_map=subgraph_output_map,
                )

        def resolve_link(link_id):
            """(origin_node_id, origin_slot) for a link, following into subgraphs."""
            if link_id not in link_idx:
                return None
            origin_node, origin_slot = link_idx[link_id]
            origin = node_by_id.get(origin_node)
            if origin is None:
                return None
            ot = origin.get("type")
            if isinstance(ot, str) and ot in self.subgraph_defs:
                # link comes out of a subgraph instance -> map to inner producer
                mapped = subgraph_output_map.get((origin_node, origin_slot))
                return mapped
            if origin.get("mode", 0) in (2, 4):
                return None  # producer is bypassed/muted
            return (self._node_api_id(id_prefix, origin_node), origin_slot)

        self._resolve_link_cache = getattr(self, "_resolve_link_cache", {})

        # Second pass: emit ordinary nodes
        for n in nodes:
            if not isinstance(n, dict):
                continue
            t = n.get("type")
            if not isinstance(t, str):
                continue
            if t in self.subgraph_defs:
                continue  # handled by expansion
            if n.get("mode", 0) in (2, 4):
                continue  # bypassed / muted -> excluded from prompt (frontend does same)
            if t in ("Note", "MarkdownNote", "PrimitiveNode", "Reroute"):
                # Reroute/Note aren't real prompt nodes. Reroute pass-through is
                # already flattened by link resolution in the frontend; we skip
                # and let links resolve to the upstream producer where possible.
                # (Templates rarely leave bare reroutes into required inputs.)
                if t in ("Note", "MarkdownNote", "PrimitiveNode"):
                    continue
                continue
            api_id = self._node_api_id(id_prefix, n["id"])
            # which input names are wired (present in node.inputs[] with a link)
            wired = {}
            for inp in (n.get("inputs") or []):
                if isinstance(inp, dict) and inp.get("link") is not None:
                    wired[inp.get("name")] = inp.get("link")
            inputs, unknown = map_widgets(t, n.get("widgets_values"), set(wired.keys()))
            if unknown:
                self.notes_unknown.add(t)
            # wired inputs -> links (override any widget slot)
            for name, link_id in wired.items():
                resolved = resolve_link(link_id)
                if resolved is not None:
                    inputs[name] = [str(resolved[0]), resolved[1]]
            title = None
            if isinstance(n.get("title"), str):
                title = n["title"]
            elif isinstance(n.get("properties"), dict) and n["properties"].get("Node name for S&R"):
                title = None  # not a user title
            entry = {"class_type": t, "inputs": inputs}
            if title:
                entry["_meta"] = {"title": title}
            api[api_id] = entry

    def _expand_subgraph_instance(self, inst, sg, outer_prefix, api, outer_link_idx, node_by_id, subgraph_output_map):
        """Flatten one subgraph instance's inner nodes into api, wiring interface."""
        prefix = f"{outer_prefix}{self.new_prefix()}_"
        inner_nodes = sg.get("nodes") or []
        inner_links = sg.get("links") or []
        inner_link_idx = self.build_link_index(inner_links)
        inner_by_id = {n["id"]: n for n in inner_nodes if isinstance(n, dict) and "id" in n}

        # interface: sg["inputs"] = list of {name,type,...} matching inst input slots
        # inner links referencing the subgraph's INPUT node resolve to outer links.
        # ComfyUI models subgraph I/O via special virtual endpoints; in the saved
        # format, inner links whose origin is the subgraph's inputNode carry a
        # slot index into sg["inputs"].
        input_node_id = sg.get("inputNode", {}).get("id") if isinstance(sg.get("inputNode"), dict) else None
        output_node_id = sg.get("outputNode", {}).get("id") if isinstance(sg.get("outputNode"), dict) else None

        # Map outer link feeding instance input slot i -> (api_id, slot)
        outer_inputs = {}
        for i, inp in enumerate(inst.get("inputs") or []):
            if isinstance(inp, dict) and inp.get("link") is not None:
                lk = outer_link_idx.get(inp["link"])
                if lk:
                    origin = node_by_id.get(lk[0])
                    if origin and isinstance(origin.get("type"), str) and origin["type"] not in self.subgraph_defs and origin.get("mode", 0) not in (2, 4):
                        outer_inputs[i] = (self._node_api_id(outer_prefix, lk[0]), lk[1])

        # Recursively expand nested subgraphs first
        nested_out = {}
        for n in inner_nodes:
            if isinstance(n, dict) and isinstance(n.get("type"), str) and n["type"] in self.subgraph_defs and n.get("mode", 0) not in (2, 4):
                self._expand_subgraph_instance(
                    n, self.subgraph_defs[n["type"]], prefix, api,
                    outer_link_idx=inner_link_idx, node_by_id=inner_by_id,
                    subgraph_output_map=nested_out,
                )

        UNFED_BOUNDARY = object()  # sentinel: link traces to a subgraph input with no outer feed

        def resolve_inner(link_id):
            if link_id not in inner_link_idx:
                return None
            on, os_ = inner_link_idx[link_id]
            if on == input_node_id:
                # origin is subgraph input boundary -> map to outer link if any.
                # If the boundary has NO external feed, the promoted inner widget
                # keeps its OWN stored value (ComfyUI's newest subgraph format
                # stores no widgets_values on the instance node; the inner node's
                # widget value is the effective default). Signal that so the
                # caller falls back to the widget value instead of dropping it.
                return outer_inputs.get(os_, UNFED_BOUNDARY)
            origin = inner_by_id.get(on)
            if origin is None:
                return None
            if isinstance(origin.get("type"), str) and origin["type"] in self.subgraph_defs:
                return nested_out.get((on, os_))
            if origin.get("mode", 0) in (2, 4):
                return None
            return (self._node_api_id(prefix, on), os_)

        # Emit inner ordinary nodes
        for n in inner_nodes:
            if not isinstance(n, dict) or not isinstance(n.get("type"), str):
                continue
            t = n["type"]
            if t in self.subgraph_defs:
                continue
            if n.get("mode", 0) in (2, 4):
                continue
            if t in ("Note", "MarkdownNote", "PrimitiveNode", "Reroute"):
                continue
            api_id = self._node_api_id(prefix, n["id"])
            wired = {}
            for inp in (n.get("inputs") or []):
                if isinstance(inp, dict) and inp.get("link") is not None:
                    wired[inp.get("name")] = inp.get("link")
            # Inputs whose link traces to an unfed boundary keep their widget
            # value → do NOT strip them from widget consumption.
            resolved_links = {name: resolve_inner(lk) for name, lk in wired.items()}
            truly_wired = {name for name, r in resolved_links.items()
                           if r is not None and r is not UNFED_BOUNDARY}
            inputs, unknown = map_widgets(t, n.get("widgets_values"), truly_wired)
            if unknown:
                self.notes_unknown.add(t)
            for name, r in resolved_links.items():
                if r is not None and r is not UNFED_BOUNDARY:
                    inputs[name] = [str(r[0]), r[1]]
            entry = {"class_type": t, "inputs": inputs}
            if isinstance(n.get("title"), str):
                entry["_meta"] = {"title": n["title"]}
            api[api_id] = entry

        # Build this instance's output map: instance output slot j -> inner producer
        # The subgraph's outputNode inner links tell which inner node feeds output j.
        for j, out in enumerate(sg.get("outputs") or []):
            # find inner link whose target is output_node_id at slot j
            producer = None
            for l in inner_links:
                if isinstance(l, list) and len(l) >= 6 and l[3] == output_node_id and l[4] == j:
                    producer = resolve_inner(l[0])
                    break
                if isinstance(l, dict) and l.get("target_id") == output_node_id and l.get("target_slot") == j:
                    producer = resolve_inner(l.get("id"))
                    break
            subgraph_output_map[(inst["id"], j)] = producer


def classify_raw_format(doc):
    if not isinstance(doc, dict):
        return "non-object"
    if isinstance(doc.get("nodes"), list) or isinstance(doc.get("links"), list):
        return "ui"
    vals = list(doc.values())
    if vals and all(isinstance(v, dict) and "class_type" in v for v in vals):
        return "api"
    return "other"


def main():
    tdir = sys.argv[1]
    files = sorted(
        f for f in glob.glob(os.path.join(tdir, "*.json"))
        if os.path.basename(f) != "manifest.json"
        and not os.path.basename(f).startswith("index")
        and os.path.basename(f) != "fuse_options.json"
    )
    out = []
    for f in files:
        base = os.path.basename(f)
        rec = {"file": base, "is_api_named": base.startswith("api_")}
        try:
            doc = json.load(open(f))
        except Exception as e:
            rec.update(ok=False, error=f"json-parse: {e}", raw_format="unreadable")
            out.append(rec)
            continue
        fmt = classify_raw_format(doc)
        rec["raw_format"] = fmt
        defs = doc.get("definitions") if isinstance(doc, dict) else {}
        rec["uses_subgraph"] = bool(isinstance(defs, dict) and defs.get("subgraphs"))
        rec["node_count"] = len(doc.get("nodes") or []) if isinstance(doc, dict) else 0
        if fmt == "api":
            rec.update(ok=True, api=doc, converter_unknown=[])
            out.append(rec)
            continue
        if fmt != "ui":
            rec.update(ok=False, error=f"not-ui-or-api: {fmt}")
            out.append(rec)
            continue
        try:
            conv = Converter(doc)
            api, notes = conv.convert()
            rec.update(ok=True, api=api, converter_unknown=sorted(conv.notes_unknown))
        except Exception as e:
            import traceback
            rec.update(ok=False, error=f"convert: {e}", tb=traceback.format_exc()[-400:])
        out.append(rec)
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
