import { readFileSync } from "node:fs";
import JSON5 from "json5";
import { resolve } from "node:path";

export interface Config {
  server: {
    host: string;
    port: number;
    maxUploadMb: number;
    uploadDir: string;
  };
  transcribe: {
    modelPath: string;
    pythonPath: string;
    maxSegmentSeconds: number;
    sampleRate: number;
  };
  ai: {
    apiUrl: string;
    apiKey: string;
    model: string;
  };
  tts: {
    voice: string;
  };
  database: {
    path: string;
  };
}

const defaults: Config = {
  server: {
    host: "0.0.0.0",
    port: 3000,
    maxUploadMb: 2048,
    uploadDir: "data/uploads",
  },
  transcribe: {
    modelPath: "large-v3",
    pythonPath: "python3",
    maxSegmentSeconds: 3600,
    sampleRate: 16000,
  },
  ai: {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4o",
  },
  tts: {
    voice: "zh-CN-YunxiNeural",
  },
  database: {
    path: "data/transcriber.db",
  },
};

let _config: Config | null = null;

export function loadConfig(configPath?: string): Config {
  const file = configPath ?? "config.json5";
  try {
    const raw = readFileSync(resolve(file), "utf-8");
    const parsed = JSON5.parse(raw);
    _config = {
      server: { ...defaults.server, ...parsed.server },
      transcribe: { ...defaults.transcribe, ...parsed.transcribe },
      ai: { ...defaults.ai, ...parsed.ai },
      tts: { ...defaults.tts, ...parsed.tts },
      database: { ...defaults.database, ...parsed.database },
    };
  } catch {
    console.warn("[Config] 配置文件加载失败，使用默认配置");
    _config = defaults;
  }

  // 环境变量覆盖敏感配置
  if (process.env.AI_API_KEY) _config.ai.apiKey = process.env.AI_API_KEY;
  if (process.env.AI_API_URL) _config.ai.apiUrl = process.env.AI_API_URL;
  if (process.env.AI_MODEL) _config.ai.model = process.env.AI_MODEL;

  // 将相对路径转为绝对路径（基于项目根目录）
  const mp = _config.transcribe.modelPath;
  if (mp && !mp.startsWith("/") && mp !== "small" && mp !== "medium" && mp !== "large-v3") {
    _config.transcribe.modelPath = resolve(mp);
  }

  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}
