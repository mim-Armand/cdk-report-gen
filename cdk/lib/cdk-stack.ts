import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_lambda as Lambda, aws_sqs as Sqs } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
// import * as cdk from "@aws-cdk/core";
import * as path from "path";
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';


export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Generate a random number as a suffix
    const randomNumber = Math.floor(Math.random() * 10000);

    const dockerfile = path.join(__dirname, "../Dockerfile");

    // const nodeLayer = new Lambda.LayerVersion(this, 'nodeLayer', {
    //   code: Lambda.Code.fromAsset('path/to/your/lambda-layer'),
    //   compatibleRuntimes: [Lambda.Runtime.NODEJS_18_X], // specify your runtime
    //   description: 'A layer for common dependencies',
    // });

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

    // Create AWS Lambda function and push image to ECR
    const lambda_01 = new Lambda.DockerImageFunction(this, "function", {
      code: Lambda.DockerImageCode.fromImageAsset(dockerfile),
      environment: {
        MAIN_QUEUE_URL: mainQueue.queueUrl,
      },
      deadLetterQueue: mainDeadLetterQueue,
      deadLetterQueueEnabled: true,
      description: "Lambda function from docker image that will generate reports based on msgs it receives from sqs",
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
      events: [new SqsEventSource(mainQueue, { batchSize: 6 })],
      functionName: `report-gen-01-${randomNumber}`,
      layers: [
        // nodeLayer
      ],
      logRetention: 30, // defaults to 14
      // vpc: undefined, // defaults to undefined
      // vpcSubnets: undefined, // defaults to undefinedx
    });

    const api = new apigateway.RestApi(this, 'api', {
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
      minimumCompressionSize: 0, // defaults to 0
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER, // defaults to HEADER
    });

    const lambdaPostReport = new Lambda.Function(this, 'lambdaPostReport', {
      runtime: Lambda.Runtime.NODEJS_18_X,
      handler: 'index.postReportHandler',
      code: Lambda.Code.fromAsset('./index.ts'),
      environment: {
        MAIN_QUEUE_URL: mainQueue.queueUrl,
      },
      description: "Lambda function that will post a report to sqs",
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
      functionName: `report-gen-01-post-report-${randomNumber}`,
      layers: [
        // nodeLayer
      ],
      logRetention: 30, // defaults to 14
      // vpc: undefined, // defaults to undefined
      // vpcSubnets: undefined, // defaults to undefinedx
    });
    lambdaPostReport.addPermission('InvokeByApiGateway', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
    })

    const postIntegration = new apigateway.LambdaIntegration(lambdaPostReport);
    api.root.addMethod('POST', postIntegration);

    // example resource
    // const queue = new sqs.Queue(this, 'CdkQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
