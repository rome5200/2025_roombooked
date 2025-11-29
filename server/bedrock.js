// bedrock_test.js
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

// 사용 중인 리전으로 변경 (예: us-east-1, us-east-2 등)
const client = new BedrockRuntimeClient({ region: "us-east-2" });

async function main() {
  const modelId = "anthropic.claude-3-5-haiku-20241022-v1:0"; // Claude 3 Haiku 예시

  const userMessage = "안녕! 너는 뭐하는 AI야?";

  const body = {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: userMessage }],
      },
    ],
    max_tokens: 256,
    temperature: 0.7,
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  try {
    const response = await client.send(command);
    const decoded = JSON.parse(Buffer.from(response.body).toString("utf-8"));
    console.log(JSON.stringify(decoded, null, 2));

    const text = decoded.output?.content?.[0]?.text || "(응답 없음)";
    console.log("\n=== 모델 응답 ===");
    console.log(text);
  } catch (err) {
    console.error("Bedrock 호출 에러:", err);
  }
}

main();
