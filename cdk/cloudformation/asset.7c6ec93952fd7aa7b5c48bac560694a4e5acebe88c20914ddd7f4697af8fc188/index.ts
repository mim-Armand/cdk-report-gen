import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
const sqs = new SQSClient();


export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    console.log('>>>>>>>>111', handlerName);
    console.log(`Event: ${JSON.stringify(event, null, 2)}`);
    console.log(`Context: ${JSON.stringify(context, null, 2)}`);
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'hello world',
        }),
    };
};

export const postReportHandler = async (event: { body: string; }) => {
    const body = JSON.parse(event.body);
    console.log('>>>>>>>>222', handlerName, body);
    const command = new SendMessageCommand({
        MessageBody: JSON.stringify(body),
        QueueUrl: process.env.QUEUE_URL,
    });

    try {
        await sqs.send(command);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Message sent to SQS' }),
        };
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error sending message to SQS' }),
        };
    }
};


// This is to use the same dockerfile for all our lambdas (DRY)
const handlerName = process.env.HANDLER_NAME || "index";
console.log('>>>>>>>>', handlerName);

let handlerFunction;
switch (handlerName) {
  case 'index':
    handlerFunction = handler;
    break;
  case 'postReportHandler':
    handlerFunction = postReportHandler;
    break;
  default:
    handlerFunction = handler;
}

export const allHandlers = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    return await handler(event, context);
  };