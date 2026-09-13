import assert from "node:assert/strict";
import test from "node:test";
import { pcm16ToWav, rmsFromPcm16 } from "../audio.ts";

test("rmsFromPcm16 returns zero for silence", () => {
  assert.equal(rmsFromPcm16(Buffer.alloc(32)), 0);
});

test("rmsFromPcm16 computes normalized sample energy", () => {
  const pcm = Buffer.alloc(4);
  pcm.writeInt16LE(16_384, 0);
  pcm.writeInt16LE(-16_384, 2);
  assert.equal(rmsFromPcm16(pcm), 0.5);
});

test("pcm16ToWav creates a 16 kHz mono PCM WAV", () => {
  const pcm = Buffer.from([1, 2, 3, 4]);
  const wav = pcm16ToWav([pcm.subarray(0, 2), pcm.subarray(2)]);

  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), 40);
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});
