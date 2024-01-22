import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutRuleCommand, RuleState } from "@aws-sdk/client-eventbridge";
import { SchedulerClient, ListSchedulesCommand, ScheduleState, FlexibleTimeWindowMode, ActionAfterCompletion, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import { TimeZone } from 'aws-cdk-lib';
const sqs = new SQSClient();


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
    downloadedBy: ["user1", "user 2"],
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
    // 2. Assign a UUID to the report and add it to the:
    // (Dynamo)DB
    // SQS
    // 3. return the report UUID and 200 success message

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


export const sqsMsgHandler = async (event: { body: string; }, context: any) => {
    // const body = JSON.parse(event.body);
    // 1. update the (dynamo) record ( mark and add to the number of the attempted progress on the report )
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
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'hello world',
        }),
    };
};

const schedulerClient = new SchedulerClient();

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
    default:
        handlerFunction = handler;
}

export const allHandlers = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    console.log('HERE 1111 >>> event', event);
    console.log('HERE 1111 >>> context', context);
    return await handlerFunction(event, context);
};

export default allHandlers;