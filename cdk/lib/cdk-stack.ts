import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_lambda as Lambda, aws_sqs as sqs, aws_s3 as s3, RemovalPolicy, aws_dynamodb as dynamodb, aws_apigateway as apigateway } from 'aws-cdk-lib';
// import * as cdk from "@aws-cdk/core";
import * as path from "path";
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';


export class ReportGenCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Generate a random number as a suffix
    const randomNumber = Math.floor(Math.random() * 10000);

    const dockerfile = path.join(__dirname, "../");

    // const nodeLayer = new Lambda.LayerVersion(this, 'nodeLayer', {
    //   code: Lambda.Code.fromAsset('path/to/your/lambda-layer'),
    //   compatibleRuntimes: [Lambda.Runtime.NODEJS_18_X], // specify your runtime
    //   description: 'A layer for common dependencies',
    // });


    
    // --------------------- DynamoDB ---------------------
    const reportsTable = new dynamodb.Table(this, 'reportsTable', {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sort',
        type: dynamodb.AttributeType.STRING,
      },
      deletionProtection: false, // todo: change after PoC
      tableName: `reports-table-${randomNumber}`,
    })

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

    // Create AWS Lambda function and push image to ECR
    const lambdaSqsConsumer = new Lambda.DockerImageFunction(this, "function", { //todo: remove this one later
      code: Lambda.DockerImageCode.fromImageAsset(dockerfile),
      environment: {
        MAIN_QUEUE_URL: mainQueue.queueUrl,
        HANDLER_NAME: 'index'
      },
      architecture: Lambda.Architecture.X86_64,
      deadLetterQueue: mainDeadLetterQueue,
      deadLetterQueueEnabled: true,
      description: "Lambda function from docker image that will generate reports based on msgs it receives from sqs",
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
      events: [new SqsEventSource(mainQueue, { batchSize: 6 })],
      functionName: `report-gen-01-${randomNumber}`,
      logRetention: 30, // defaults to 14
      // vpc: undefined, // defaults to undefined
      // vpcSubnets: undefined, // defaults to undefinedx
    });


    const lambdaPostReport = new Lambda.DockerImageFunction(this, 'lambdaPostReport', {
      code: Lambda.DockerImageCode.fromImageAsset(dockerfile),
      environment: {
        MAIN_QUEUE_URL: mainQueue.queueUrl,
        HANDLER_NAME: 'postReportHandler'
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

    const postIntegration = new apigateway.LambdaIntegration(lambdaPostReport);
    apigw.root.addMethod('POST', postIntegration);

    // example resource
    // const queue = new sqs.Queue(this, 'CdkQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
