import test from "node:test";
import assert from "node:assert/strict";
import { parseUnityFiles } from "./unity.mjs";

test("generated scripts stay in the designated folder", () => {
  for (const name of [
    "../secret.cs",
    "Assets/Editor/Bad.cs",
    "Assets/Scripts/../../Bad.cs",
    "C:/Bad.cs",
    "Assets/Scripts/Bad.cs:stream",
  ]) {
    assert.throws(() =>
      parseUnityFiles(
        JSON.stringify({ files: [{ path: name, content: "code" }] }),
      ),
    );
  }
});
test("duplicate filenames cannot overwrite each other on Windows", () => {
  assert.throws(() =>
    parseUnityFiles(
      JSON.stringify({
        files: [
          { path: "Assets/Scripts/Game.cs", content: "a" },
          { path: "Assets/Scripts/game.cs", content: "b" },
        ],
      }),
    ),
  );
});
test("accepts a fenced valid response", () => {
  const files = [
    {
      path: "Assets/Scripts/GameBootstrap.cs",
      content: "class GameBootstrap {}",
    },
  ];
  assert.deepEqual(
    parseUnityFiles("```json\n" + JSON.stringify({ files }) + "\n```"),
    files,
  );
});
