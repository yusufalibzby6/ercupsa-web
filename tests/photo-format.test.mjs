import assert from "node:assert/strict";
import { test } from "node:test";
import { photoFormat } from "../netlify/lib/photo-format.mjs";

const lossy = Buffer.from("UklGRjwAAABXRUJQVlA4IDAAAAAwAgCdASoCAAIAAUAmJaACdLoB+AH4AARoAAD+7HDf/SaNU/H2lv/rKr5Kj9swAAA=", "base64");
const lossless = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQwVIUuf+BiOh/AAA=", "base64");
const extended = Buffer.from("UklGRmgAAABXRUJQVlA4WAoAAAAYAAAAAQAAAQAAQUxQSAUAAAAAeHh4eABWUDggMAAAADACAJ0BKgIAAgABQCYloAJ0ugH4AfgABGgAAP7scN/9Jo1T8faW/+sqvkqP2zAAAEVYSUYEAAAAdGVzdA==", "base64");

test("private photo sniffing accepts real lossy and lossless WebP and strips trailing phone metadata", () => {
  for (const bytes of [lossy, lossless, extended]) {
    const image = photoFormat(Buffer.concat([bytes, Buffer.from("Android_metadata")]));
    assert.equal(image.mime, "image/webp"); assert.equal(image.extension, "webp");
    assert.deepEqual(image.bytes, bytes);
  }
});

test("WebP needs a complete RIFF container and a supported image frame", () => {
  const changed = [];
  for (const bytes of [lossy, lossless]) {
    changed.push(bytes.subarray(0, -1));
    const tooLong = Buffer.from(bytes); tooLong.writeUInt32LE(bytes.length + 20, 4); changed.push(tooLong);
    const frameTooLong = Buffer.from(bytes); frameTooLong.writeUInt32LE(bytes.length, 16); changed.push(frameTooLong);
    const nonImage = Buffer.from(bytes); nonImage.write("JUNK", 12); changed.push(nonImage);
  }
  const fakeFrame = Buffer.from(lossy); fakeFrame[23] = 0; changed.push(fakeFrame);
  const zeroWidth = Buffer.from(lossy); zeroWidth.writeUInt16LE(0, 26); changed.push(zeroWidth);
  const badLosslessVersion = Buffer.from(lossless); badLosslessVersion[24] |= 0xe0; changed.push(badLosslessVersion);
  const animation = Buffer.from(extended); animation[20] |= 2; changed.push(animation);
  for (const bytes of changed) assert.equal(photoFormat(bytes), null);
});

test("photo fields never accept PDF, SVG, HEIC or an image extension without actual image contents", () => {
  for (const bytes of [Buffer.from("%PDF-1.4\n%%EOF\n"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    Buffer.from("0000ftypheic"), Buffer.from("image/jpeg"), Buffer.alloc(0)])
    assert.equal(photoFormat(bytes), null);
});
