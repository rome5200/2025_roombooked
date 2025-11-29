// index.mjs (또는 index.js 에서 import 대신 require 써도 됨)
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: "ap-northeast-2" }); // 사용하는 리전

export const handler = async (event) => {
  try {
    // API Gateway의 HTTP API일 경우 body가 string일 수 있음
    const body = typeof event.body === "string" ? JSON.parse(event.body || "{}") : (event.body || {});
    const { prompt } = body;

    if (!prompt) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "prompt 필드가 필요합니다." }),
      };
    }

    const modelId = "anthropic.claude-3-sonnet-20240229-v1:0"; // 실제 사용 모델 ID로 변경

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 512,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const response = await client.send(command);

    const responseString = new TextDecoder("utf-8").decode(response.body);
    const responseJson = JSON.parse(responseString);

    // Claude 응답 구조에서 텍스트만 뽑기
    const text = responseJson.content
      ?.map((c) => c.text)
      .join("\n") || "";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",          // CORS (필요시 도메인 제한)
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({ result: text }),
    };
  } catch (err) {
    console.error("Bedrock Lambda Error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json",
                 "Access-Control-Allow-Origin": "*",
                 "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({ message: "Internal Server Error", error: String(err) }),
    };
  }
};
