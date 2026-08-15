// ESLint flat config（ESLint 9+）：TypeScript 标准配置，与 Prettier 协同（eslint-config-prettier 关闭格式类规则）
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "docs/superpowers/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // 项目内已按需放宽的规则（保持现有代码可迁移）
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // 清理类操作（rmSync/renameSync 尽力而为）空 catch 属有意忽略，允许
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
