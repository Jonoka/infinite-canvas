import assert from "node:assert/strict";
import { imageSizeLabel, __test__ } from "./image-settings-panel";

const expectedAspectOptions = [
    ["1:1", "1:1", 1024, 1024],
    ["3:2", "3:2", 1536, 1024],
    ["2:3", "2:3", 1024, 1536],
    ["4:3", "4:3", 1152, 864],
    ["3:4", "3:4", 864, 1152],
    ["5:4", "5:4", 1120, 896],
    ["4:5", "4:5", 896, 1120],
    ["16:9", "16:9", 1280, 720],
    ["9:16", "9:16", 720, 1280],
    ["21:9", "21:9", 1456, 624],
    ["auto", "auto", 0, 0],
] as const;

assert.deepEqual(
    __test__.aspectOptions.map((item) => [item.value, item.label, item.width, item.height]),
    expectedAspectOptions,
    "image settings should expose the new 1K gpt-image ratio presets and remove stale 2K/4K explicit ratio buttons",
);

for (const [value, label] of expectedAspectOptions) {
    assert.equal(imageSizeLabel(value), label);
}

assert.deepEqual(__test__.readSizeDimensions("16:9", __test__.aspectOptions.find((item) => item.value === "16:9")!), { width: 1280, height: 720 });
assert.deepEqual(__test__.readSizeDimensions("4:3", __test__.aspectOptions.find((item) => item.value === "4:3")!), { width: 1152, height: 864 });
assert.equal(__test__.alignDimension(721, true), 736);
assert.equal(__test__.alignDimension(721, false), 721);
