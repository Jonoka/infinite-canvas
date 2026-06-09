import assert from "node:assert/strict";

import { __test__ } from "./video";

const config = { videoSeconds: "8", size: "1280x720", vquality: "720" } as never;
const file = new File([new Blob(["x"], { type: "image/png" })], "ref.png", { type: "image/png" });

const textToVideo = __test__.buildOpenAIVideoFormData(config, "veo3.1-pro", "prompt", []);
assert.equal(textToVideo.get("type"), "1");
assert.equal(textToVideo.has("reference_mode"), false);
assert.equal(textToVideo.get("seconds"), "8");
assert.equal(textToVideo.get("size"), "1280x720");
assert.equal(textToVideo.get("resolution_name"), "720p");
assert.equal(textToVideo.get("preset"), "normal");

const imageToVideo = __test__.buildOpenAIVideoFormData(config, "veo3.1-pro", "prompt", [file]);
assert.equal(imageToVideo.get("type"), "2");
assert.equal(imageToVideo.get("reference_mode"), "image");
assert.equal(imageToVideo.getAll("input_reference[]").length, 1);

const components = __test__.buildOpenAIVideoFormData(config, "veo3.1-components", "prompt", [file, file]);
assert.equal(components.get("type"), "3");
assert.equal(components.get("reference_mode"), "components");
assert.equal(components.getAll("input_reference[]").length, 2);
