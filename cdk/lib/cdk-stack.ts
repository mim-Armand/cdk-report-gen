import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { 
  aws_lambda      as Lambda,
  aws_sqs         as sqs, 
  aws_s3          as s3, RemovalPolicy,
  aws_dynamodb    as dynamodb,
  aws_apigateway  as apigateway,
  aws_apigatewayv2 as apigatewayv2,
  aws_iam         as iam,
     } from 'aws-cdk-lib';
// import * as cdk from "@aws-cdk/core";
import * as path from "path";
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';


export class ReportGenCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // adding tags to all the resources in the stack:
    cdk.Tags.of(this).add('prjct', 'report-gen-01');

    // Generate a random number as a suffix
    const randomNumber = Math.floor(Math.random() * 10000);

    const dockerfile = path.join(__dirname, "../");

    // --------------------- DynamoDB ---------------------
    const gsi1: dynamodb.GlobalSecondaryIndexProps = {
      indexName: "requestedByUser",
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timeStamp',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL, // this includes all nonKey attributes, but should be changed to INCLUDE if the record is large
      // nonKeyAttributes: ['status'], // include any fields that is needed when querying secondary indexes
    };
    const reportsTable = new dynamodb.Table(this, 'reportsTable', {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sort',
        type: dynamodb.AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.DESTROY, // todo: in a real env this should be changed to retain
      deletionProtection: false, // todo: change after PoC
      tableName: `reports-table-${randomNumber}`,
    })
    reportsTable.addGlobalSecondaryIndex(gsi1);

    // --------------------- S3 Bucket ---------------------
    const lifecycleRules: s3.LifecycleRule = {
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(3),
      enabled: false,
      expiredObjectDeleteMarker: false,
      id: 'id',
      // expiration: cdk.Duration.days(39),
      // noncurrentVersionExpiration: cdk.Duration.days(60),
      // noncurrentVersionsToRetain: 54,
      // noncurrentVersionTransitions: [{
      //   storageClass: s3.StorageClass.INFREQUENT_ACCESS,
      //   transitionAfter: cdk.Duration.days(99),
      //   // the properties below are optional
      //   noncurrentVersionsToRetain: 123,
      // }],
      prefix: 'report', // if an object prefix changes, the lifecycle will ignore it ( IE: remains where it is )
      transitions: [{
        storageClass: s3.StorageClass.INFREQUENT_ACCESS,
        transitionAfter: cdk.Duration.days(33),
      },
      {
        storageClass: s3.StorageClass.GLACIER,
        transitionAfter: cdk.Duration.days(99),
      }
    ],
    };

    const reportsBucket = new s3.Bucket(this, 'ReportsBucket', {
      removalPolicy: RemovalPolicy.DESTROY, //todo this needs to be RETAIN outside of PoC
      autoDeleteObjects: true,  //todo this needs to be RETAIN outside of PoC
      bucketName: `generated-reports-${randomNumber}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      eventBridgeEnabled: true,
      lifecycleRules: [lifecycleRules]
    })
    // --------------------- SQS ---------------------
    const mainDeadLetterQueue = new sqs.Queue(this, 'MainDeadLetterQueue', {
      queueName: `MainDeadLetterQueue-${randomNumber}`
    });
    const mainQueue = new sqs.Queue(this, 'MainQueue', {
      queueName: `MainQueue-${randomNumber}`,
      visibilityTimeout: cdk.Duration.seconds(900),
      deadLetterQueue: {
        maxReceiveCount: 2,
        queue: mainDeadLetterQueue,
      }
    });
    // --------------------- EventBridge ---------------------
    const scheduleSqsRole = new iam.Role(this, 'scheduleSqsRole', {
      roleName: `schedule-sqs-role-${randomNumber}`,
      description: 'This role lets EventBridge Scheduler to send messages to SQS',
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com')
    });
    scheduleSqsRole.addToPolicy(new iam.PolicyStatement({
      actions:['sqs:SendMessage'],
      resources:[mainQueue.queueArn, mainDeadLetterQueue.queueArn]
    }));

    const reportsEventbridgeScheduleGroup = new cdk.aws_scheduler.CfnScheduleGroup(this, 'reportsEventbridgeScheduleGroup',
    {
      name: `reports-shcedule-group-${randomNumber}`, // todo: this needs to be passed to the lambda env so events are added to the right group
    });

    // --------------------- Lambda ---------------------
    // Create AWS Lambda function and push image to ECR
    const lambdaSqsConsumer = new Lambda.DockerImageFunction(this, "function", {
      code: Lambda.DockerImageCode.fromImageAsset(dockerfile),
      environment: {
        MAIN_QUEUE_URL: mainQueue.queueUrl,
        HANDLER_NAME: 'sqsMsgHandler',
        REPORTS_TABLE_NAME: reportsTable.tableName,
        S3_BUCKET_NAME: reportsBucket.bucketName,
      },
      architecture: Lambda.Architecture.X86_64,
      deadLetterQueue: mainDeadLetterQueue,
      deadLetterQueueEnabled: true,
      description: "Lambda function from docker image that will generate reports based on msgs it receives from sqs",
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
      events: [new SqsEventSource(mainQueue, { batchSize: 6 })],
      functionName: `report-gen-sqs-consumer-01-${randomNumber}`,
      logRetention: 30, // defaults to 14
      // vpc: undefined, // defaults to undefined
      // vpcSubnets: undefined, // defaults to undefinedx
    });
    reportsBucket.grantWrite(lambdaSqsConsumer);

    const lambdaGetTest = new Lambda.DockerImageFunction(this, 'lambdaGetTest', {
      code: Lambda.DockerImageCode.fromImageAsset(dockerfile),
      environment: {
        HANDLER_NAME: 'index'
      },
      architecture: Lambda.Architecture.X86_64,
      description: "Lambda function that will simply echoes back ( for testing and diag )",
      functionName: `report-gen-01-test-${randomNumber}`
    });

    const lambdaPostReport = new Lambda.DockerImageFunction(this, 'lambdaPostReport', {
      code: Lambda.DockerImageCode.fromImageAsset(dockerfile),
      environment: {
        MAIN_QUEUE_URL: mainQueue.queueUrl,
        HANDLER_NAME: 'postReportHandler',
        REPORTS_TABLE_NAME: reportsTable.tableName,
      },
      architecture: Lambda.Architecture.X86_64,
      description: "Lambda function that will post a report to sqs",
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
      functionName: `report-gen-01-post-report-${randomNumber}`,
      deadLetterQueue: mainDeadLetterQueue,
      deadLetterQueueEnabled: true,
      // logRetention: 30, // defaults to 14
      // vpc: undefined, // defaults to undefined
      // vpcSubnets: undefined, // defaults to undefinedx
    });
    lambdaPostReport.addPermission('InvokeByApiGateway', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    mainQueue.grantSendMessages(lambdaPostReport);
    mainDeadLetterQueue.grantConsumeMessages(lambdaPostReport);
    reportsTable.grantReadWriteData(lambdaPostReport);
    

    const lambdaPostSchedule = new Lambda.DockerImageFunction(this, 'lambdaPostSchedule', {
      code: Lambda.DockerImageCode.fromImageAsset(dockerfile),
      environment: {
        MAIN_QUEUE_URL: mainQueue.queueUrl,
        MAIN_QUEUE_ARN: mainQueue.queueArn,
        DEAD_QUEUE_ARN: mainDeadLetterQueue.queueArn,
        HANDLER_NAME: 'postScheduleHandler',
        SCHEDULE_SQS_ROLE_URL: scheduleSqsRole.roleArn,
        // EVENT_BUS_NAME: schedulerEventBus.eventBusName,
        SCHEDULE_GROUP_NAME: reportsEventbridgeScheduleGroup.name || 'default',
      },
      architecture: Lambda.Architecture.X86_64,
      description: "Lambda function that will post a schedule to generate reports on a cron or rate",
      functionName: `report-gen-01-schedule-report-${randomNumber}`,
      deadLetterQueue: mainDeadLetterQueue,
      deadLetterQueueEnabled: true,
    });
    lambdaPostSchedule.addPermission('InvokeByApiGateway', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    mainQueue.grantConsumeMessages(lambdaPostSchedule);
    mainDeadLetterQueue.grantConsumeMessages(lambdaPostSchedule);
    reportsTable.grantReadWriteData(lambdaPostSchedule);
    // schedulerEventBus.grantPutEventsTo(lambdaPostSchedule);
    lambdaPostSchedule.role?.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['events:PutRule', 'iam:PassRole', 'scheduler:CreateSchedule'],
      resources: ['*'],
    }))
    // --------------------- APIGateway ---------------------
    const apigw = new apigateway.RestApi(this, 'apigw', {
      restApiName: 'report-gen-01',
      endpointExportName: 'report-gen-01-endpoint',
      description: 'This service generates reports based on msgs it receives from sqs',
      deployOptions: {
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      defaultMethodOptions: {
        authorizationType: apigateway.AuthorizationType.NONE,
      },
      retainDeployments: false,
      endpointTypes: [apigateway.EndpointType.REGIONAL], // defaults to EDGE
      disableExecuteApiEndpoint: false, // defaults to true
      cloudWatchRole: false, // defaults to true
      deploy: true, // defaults to true
      // minimumCompressionSize: 0, // defaults to 0 // minCompressionSize
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER, // defaults to HEADER
    });

    const getTest = new apigateway.LambdaIntegration(lambdaGetTest);
    const testResource = apigw.root.addMethod(apigatewayv2.HttpMethod.GET, getTest);

    const reportResource = apigw.root.addResource('reports');
    const postReport = new apigateway.LambdaIntegration(lambdaPostReport);
    reportResource.addMethod(apigatewayv2.HttpMethod.POST, postReport);

    const scheduleResource = reportResource.addResource('schedules');
    const postSchedule = new apigateway.LambdaIntegration(lambdaPostSchedule);
    scheduleResource.addMethod(apigatewayv2.HttpMethod.POST, postSchedule)

  }
}
