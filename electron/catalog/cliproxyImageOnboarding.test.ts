// CLIProxy（本机 OpenAI 兼容代理，127.0.0.1:8317）图片接入的契约钉子。
// 代理源码只读核对（CLIProxyAPI-Tabbit）：internal/api/server_routes.go 挂 /v1/images/generations
// 与 /v1/images/edits；sdk/api/handlers/openai/openai_images_handlers.go 默认 images tool 模型
// gpt-image-2，多处路径强制 responseFormat="b64_json"（279/666/811/954 行）——故 b64 返回是
// 一等公民，不能只按 url 读。全部为离线断言，不做真实网络调用。
import { describe, expect, it } from "vitest";
import { guessModelKind } from "./modelKindHeuristic";
import { draftShapeForKind } from "./catalogCommit";
import { joinUrl } from "../ai/requestPipeline";
import { NEWAPI_IMAGE_CREATE_OP, OPENAI_MULTIPART_IMAGE_EDIT_OP, newapiImageEditProfileForModel } from "./newapiTransport";
import { readTaskResponse } from "../tasks/taskResultReading";

// 结构有效的最小图片文件头（≥12 字节才过 contentTypeFromMagicBytes 嗅探门槛）。
const JPEG_HEADER_B64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
]).toString("base64");
const PNG_HEADER_B64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]).toString("base64");

describe("CLIProxy 图片接入（OpenAI 兼容面）", () => {
  it("gpt-image 系模型 id 不落文本桶（/models 拉取分类）", () => {
    for (const id of ["gpt-image-2", "gpt-image-2.5", "gpt-image-1.5", "gpt-image-2.5-flare"]) {
      expect(guessModelKind(id)).toBe("image");
    }
  });

  it("接入落库按 kind=image 生成生成+改图双通道，改图走 multipart edits（gpt-image 智能默认）", () => {
    const draft = draftShapeForKind("image", "gpt-image-2");
    expect(draft.targetKind).toBe("image");
    expect(draft.mappingCreate?.path).toBe("/v1/images/generations");
    expect(draft.mappingCreate?.method).toBe("POST");
    expect(draft.mappingEdit?.path).toBe("/v1/images/edits");
    expect(draft.mappingEdit?.multipart?.imageField).toBe("image[]");
    expect(draft.mappingEdit?.multipart?.multiple).toBe(true);
  });

  it("URL 回包按合同读：data[*].url 多图全收（n>1）", () => {
    const reading = readTaskResponse({
      response: { created: 1, data: [{ url: "https://img.example.test/1.png" }, { url: "https://img.example.test/2.png" }] },
      responseMapping: NEWAPI_IMAGE_CREATE_OP.response_mapping as Record<string, unknown>,
      statusMapping: undefined,
      wantedKind: "image",
    });
    expect(reading.rule).toBe("contract");
    expect(reading.assetUrls).toEqual(["https://img.example.test/1.png", "https://img.example.test/2.png"]);
  });

  it("b64_json 回包走通用规则：多张全收、魔数定真类型（代理多处路径只回 b64）", () => {
    // 夹具为结构有效的最小文件头（≥12 字节才过通用魔数嗅探门槛）：JPEG=SOI+APP0("JFIF\0")，
    // PNG=签名+IHDR。不是 6 字节片段——那种会按 image/png 兜底，是嗅探的既定行为而非 bug。
    const reading = readTaskResponse({
      response: { created: 1, data: [{ b64_json: JPEG_HEADER_B64 }, { b64_json: PNG_HEADER_B64 }] },
      responseMapping: NEWAPI_IMAGE_CREATE_OP.response_mapping as Record<string, unknown>,
      statusMapping: undefined,
      wantedKind: "image",
    });
    expect(reading.status).toBe("succeeded");
    expect(reading.assetUrls).toHaveLength(2);
    expect(reading.assetUrls[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(reading.assetUrls[1]).toMatch(/^data:image\/png;base64,/);
  });

  it("本机代理 baseUrl（带或不带 /v1）拼图片端点都不双前缀", () => {
    expect(joinUrl("http://127.0.0.1:8317/v1", "/v1/images/generations")).toBe("http://127.0.0.1:8317/v1/images/generations");
    expect(joinUrl("http://127.0.0.1:8317", "/v1/images/generations")).toBe("http://127.0.0.1:8317/v1/images/generations");
  });

  it("gpt-image 之外的模型仍按族选协议，不把聊天接口当图片生成接口", () => {
    expect(newapiImageEditProfileForModel("gpt-image-2").operation).toBe(OPENAI_MULTIPART_IMAGE_EDIT_OP);
    expect(newapiImageEditProfileForModel("some-unknown-image-model").protocol).toBe("chat-completions-image-url");
    // 生成主通道永远是 /v1/images/generations，不是 /v1/chat/completions：
    expect(NEWAPI_IMAGE_CREATE_OP.path).toBe("/v1/images/generations");
  });
});
