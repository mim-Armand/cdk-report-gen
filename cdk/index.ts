import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SchedulerClient, ListSchedulesCommand, ScheduleState, FlexibleTimeWindowMode, ActionAfterCompletion, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import { TimeZone } from 'aws-cdk-lib';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
const sqs = new SQSClient();
// const dynamoClient = new DynamoDBClient({});
// const dynamo = DynamoDBDocumentClient.from(dynamoClient);
const ddb = new DynamoDB();
const schedulerClient = new SchedulerClient();
const s3Client = new S3Client();
export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    console.log(`Event: ${JSON.stringify(event, null, 2)}`);
    console.log(`Context: ${JSON.stringify(context, null, 2)}`);
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'hello world',
            event, context
        }),
    };
};


const sampleReportRecord = {
    requestedBy: "user_id",
    downloadedBy: [{user: "user1", timestamp: "", metadata: {}}],
    scheduled: false,
    status: 10,
    createdAt: "123",
    type: "report_type",
}

export const postReportHandler = async (event: { body: string; }) => {
    const body = JSON.parse(event.body);
    const command = new SendMessageCommand({
        MessageBody: JSON.stringify(body),
        QueueUrl: process.env.MAIN_QUEUE_URL,
    });
    // 1. access control
    // if access denied log the request and notify ( as it might be an early sign of an intrusion attempt )
    // 2. Post the msg to SQS and get the UUID
    // 3. add the record ro dynamodb ( alert if already exist )
    // 3. return the report UUID and 200 success message

    try {
        const res = await sqs.send(command);
        const dynamoRes = await ddb.putItem({
            TableName: process.env.REPORTS_TABLE_NAME,
            ReturnValues: "NONE",
            Item: {
                userId: { S: body.requestedBy || 'system' },
                timestamp: { S: new Date().toISOString() },
                reportId: { S: res.MessageId || '000' },
                id: { S: res.MessageId || '000' },
                sort: { S: new Date().toISOString() },
                scheduled: { BOOL: false },
                status: { N: '0' },
                // touched: { N: "1"},
                // ...sampleReportRecord,
            }
        });
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                messageId: res.MessageId,message: 'Message sent to SQS',
                dynamoRes, sqsRes: res
         }),
        };
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error sending message to SQS', msg: error }),
        };
    }
};

const isReportGenRequsetValid = (body: any) => {
    if (typeof body !== 'object') return false; // this checks for the type of the body
    //todo:
    // 1. check regexp for reportName
    // 2. check for the required fields
    const requiredFields = {
        reportName: 'report_name',
        requestedBy: 'userId',
        reportType: 'report-123',
    }
    
    // if (Object.keys(body).length === 0) return false; // this checks for the length of the body ( if it's empty )
    // if (Object.keys(body).length !== Object.keys(requiredFields).length) return false; // this checks for the length of the body ( if it's empty )
    // if (Object.keys(body).some(key => !requiredFields[key])) return false; // this checks for the required keys ( if it's empty )
    // if (Object.keys(body).some(key => !body[key])) return false; // this checks for the required keys ( if it's empty )
    // if (Object.keys(body).some(key => typeof body[key] !== 'string')) return false; // this checks for the required keys ( if it's empty )
    // if (Object.keys(body).some(key => body[key].length === 0)) return false; // this checks for the required keys ( if it's empty )

    return Object.keys(requiredFields).every(key => key in body); // this checks for all the required keys
}
export const sqsMsgHandler = async (event: { Records: [{body: string}]; }, context: any) => {
    //todo: put the error messages in an array in Dynamodb
    console.log('starting the sqsMsgHandler ...');
    if(typeof event !== 'object') throw new Error('The event passed form SQS should always be a json.');
    const msgs = event.Records;
    if( msgs.length !== 1 ) throw new Error( `We shouldn't have received more or less than 1 message. (actual count= ${msgs.length})`); // else use: event.Records.forEach(record => {
    const msg = msgs[0];
    const msgBody = validateAndParse(msg.body);
    if (!msgBody) throw new Error( 'Bad Request: Message Body is not valid JSON. >>' + msg.body);
    if (!isReportGenRequsetValid(msgBody)) throw new Error('Bad Request: the required fields are missing from the message.');
    
    // 1. update the (dynamo) record ( mark and add to the number of the attempted progress on the report: touched++ )
    // 2. access control ( double check that the requested report and requested user roles patch )
    // If not, log and notify
    // 3. attempt to query the db based on the requested report type
    // This part is left open as it requires another PoC and Json has a great solution for it
    // 4. attempt to generate the report file
    // 5. put the report file on S3
    // 6. Update the (dynamo) record and set the request as complete and add the S3 object name of information to build it
    // E. error handling and DQL logic as appropriate
    console.log(`sqsMsgHandler event: >>> ${JSON.stringify(event, null, 2)}`);
    console.log(`sqsMsgHandler Context: >>> ${JSON.stringify(context, null, 2)}`);
    const allocatedMemory = process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
    const usedMemory = process.memoryUsage();
    for (let key in usedMemory) {
        console.log(`>>> ${key} ${Math.round(usedMemory[key] / 1024 / 1024 * 100) / 100} MB`);
      }
    console.log(`>>> Allocated Memory: ${allocatedMemory} MB`);

    //1. Ignored for PoC
    //2. Ignored for PoC
    //3. DB response is mocked
    //4. The report file can be generated with excel4node or Python scripts
    console.log(' puttin a the file in the S3 bucket', process.env.S3_BUCKET_NAME);

    const s3Res = await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: msgBody.reportName,
        Body: 'Hello World!',
    }));
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'hello world',
            s3Res,
        }),
    };
};

const isSchedRequsetValid = (body: any) => {
    const requiredFields = {
        reportName: 'report_name',
        requestedBy: 'userId',
        scheduleExpression: 'cron(0 0 1 * ? *)', // node-cron package can help to validate this
        reportType: 'report-123',
    }
    return Object.keys(requiredFields).every(key => key in body); // this checks for all the required keys
}
const validateAndParse = (jsonString: string) => {
    try {
        const res = JSON.parse(jsonString);
        return res;
    } catch (e) {
        return false;
    }
}

const errResponse = (statusCode: number, message: string) => ({ statusCode, body: JSON.stringify({ message }) })

export const postScheduleHandler = async (event: any) => { //todo: update the type
    console.log('Start! >>>>>');
    console.log('postScheduleHandler event >>>>>', event.body);

    // 1. Check user access and permissions
    // 2. Check if request is valid ( all required fields are passed, the requested time is not in the past, etc.)
    // 3. Add the schedule to eventbridge
    // If it's a cron, setup a cron schedule (addCronSchedule), if it's a one time, do accordingly, for poc we'll cover cron
    // 4. respond with the schedule ID
    const body = validateAndParse(event.body);
    if (!body) return errResponse(400, 'Bad Request: Payload is not valid JSON.');
    if (!isSchedRequsetValid(body)) return errResponse(400, 'Bad Request: the required fields are missing. ');
    const nameRegex = /^[.\-_A-Za-z0-9]+$/;
    if (!nameRegex.test(body.reportName)) return errResponse(400, `1 validation error detected: Value ${body.reportName} at 'reportName' failed to satisfy constraint: Member must satisfy regular expression pattern: [\\.\\-_A-Za-z0-9]+`)

    // const input_old = { // PutRuleRequest
    //     Name: body.requestedBy + '-' + body.reportName, // required
    //     ScheduleExpression: body.scheduleExpression, // "cron(0 0 1 * ? *)", // min, hours, day of month, month, day of week, year.. or can be a rate(2 days) <-- every 2 days (minute | minutes | hour | hours | day | days)
    //     State: RuleState.ENABLED, // we can get this from the UI and let users enable/disable schedules for ux
    //     Description: body.description || `The scheduling event for report generation created by user ${body.requestedBy}`,
    //     RoleArn: process.env.SCHEDULE_SQS_ROLE_URL,
    // };
    const input = { // CreateScheduleInput
        Name: body.requestedBy + '_' + body.reportName, // required
        GroupName: process.env.SCHEDULE_GROUP_NAME,
        ScheduleExpression: body.scheduleExpression, // "cron(0 0 1 * ? *)", // min, hours, day of month, month, day of week, year.. or can be a rate(2 days) <-- every 2 days (minute | minutes | hour | hours | day | days)
        StartDate: new Date(), // now
        EndDate: new Date(new Date().getTime() + (24 * 60 * 60 * 1000)), // todo: this is here just to control and reduce cost in PoC should be removed later on
        Description: body.description || `The scheduling event for report generation created by user ${body.requestedBy}`,
        // ScheduleExpressionTimezone: TimeZone.AMERICA_CHICAGO.timezoneName, // todo: This too 3 days for me to fix! AWS sucks at error msgs!!
        State: ScheduleState.ENABLED,
        Target: { // Target
            Arn: process.env.MAIN_QUEUE_ARN,
            RoleArn: process.env.SCHEDULE_SQS_ROLE_URL,
            DeadLetterConfig: {
                Arn: process.env.DEAD_QUEUE_ARN,
            },
            RetryPolicy: {
                // MaximumEventAgeInSeconds: Number("int"),
                MaximumRetryAttempts: Number(3),
            },
            // Input: "test input, change to json later!",
            Input: JSON.stringify({
                ...body,
                scheduled: true,
            }), //todo: check, this might need to be stringified
            //   EventBridgeParameters: { // EventBridgeParameters
            //     DetailType: "STRING_VALUE", // required
            //     Source: "STRING_VALUE", // required
            //   },
            //   SqsParameters: { // SqsParameters
            //     MessageGroupId: "STRING_VALUE",
            //   },
        },
        FlexibleTimeWindow: { // FlexibleTimeWindow
            Mode: FlexibleTimeWindowMode.OFF,
            //   MaximumWindowInMinutes: Number(15),
        },
        // ClientToken: "STRING_VALUE", // if ommited autogenerated automatically but can be specified for idempotency
        ActionAfterCompletion: ActionAfterCompletion.NONE,
    };
    // const putCommand = new PutRuleCommand(input);
    const putCommand = new CreateScheduleCommand(input);
    const scheduleResponse = await schedulerClient.send(putCommand);
    console.log('Schedule created! >>>>', scheduleResponse);
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Schedule was added!',
            scheduleResponse
        }),
    };
}

export const getReportsHandler = async (event: any, context: any) => {
    // 1. the user id is taken from the trusted headers and JWT and not coming from the request body or client
    // 2. access control ( omitted from PoC )
    // 3. this endpoint provides paginated results and the requested page can be obtained from url params ( Omitted from PoC )
    // 4. Query the DB with the user ID and return the last 10 items with IDs ( ID can be encrypted, but this is omitted in PoC )
    const params = {
        TableName: process.env.REPORTS_TABLE_NAME,
        IndexName: 'requestedByUser',
        KeyConditionExpression: "#userId = :userId",
        ExpressionAttributeNames: {
            "#userId": "userId"
          },
        ScanIndexForward: false,
        Limit: 10,
        ExpressionAttributeValues: {
            ':userId': { S: "mim" },
        },
        // ExclusiveStartKey: lastEvaluatedKey // TODO:  For pagination, we can check if the value is passed from the client
    }
    console.log('>>>params: ', params)
    
        return ddb.query(params).then(res => {
            console.log('>>>>>', res)
            return {
                statusCode: 200,
                body: JSON.stringify({res}),
            };
        }).catch(err => {
            console.log('Error querying DynamoDB', err);
            throw err;
        })
        

}


// This is to use the same dockerfile for all our lambdas (DRY)
const handlerName = process.env.HANDLER_NAME || "index";

let handlerFunction: any;
switch (handlerName) {
    case 'index':
        handlerFunction = handler;
        break;
    case 'postReportHandler':
        handlerFunction = postReportHandler;
        break;
    case 'sqsMsgHandler':
        handlerFunction = sqsMsgHandler;
        break;
    case 'postScheduleHandler':
        handlerFunction = postScheduleHandler;
        break;
    case 'getReportsHandler':
        handlerFunction = getReportsHandler;
        break;
    default:
        handlerFunction = handler;
}

export const allHandlers = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    console.log('HERE 1111 >>> event', event);
    console.log('HERE 1111 >>> context', context);
    return await handlerFunction(event, context);
};

export default allHandlers;