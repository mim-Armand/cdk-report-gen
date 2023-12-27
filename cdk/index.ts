import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import AWS from 'aws-sdk';
const sqs = new AWS.SQS();

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    console.log(`Event: ${JSON.stringify(event, null, 2)}`);
    console.log(`Context: ${JSON.stringify(context, null, 2)}`);
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'hello world',
        }),
    };
};

export const postReportHandler = async (event) => {
    const body = JSON.parse(event.body);
    const params = {
        QueueUrl: process.env.QUEUE_URL,
        MessageBody: JSON.stringify(body)
    };

    try {
        await sqs.sendMessage(params).promise();
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