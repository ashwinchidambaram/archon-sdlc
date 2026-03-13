import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiConstructProps {
  table: dynamodb.Table;
  bucket: s3.Bucket;
  stateMachineArn: string;
  userPoolId: string;
  userPoolClientId: string;
  plannerFunctionName: string;
}

export class ApiConstruct extends Construct {
  public readonly api: apigatewayv2.HttpApi;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const { table, bucket, stateMachineArn } = props;

    const commonLambdaProps = {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../backend/api/package')),
      environment: {
        PROJECTS_TABLE: table.tableName,
        ARTIFACTS_BUCKET: bucket.bucketName,
      },
    };

    const createProjectFn = new lambda.Function(this, 'CreateProjectFn', {
      ...commonLambdaProps,
      handler: 'create_project.lambda_handler',
    });

    const startPipelineFn = new lambda.Function(this, 'StartPipelineFn', {
      ...commonLambdaProps,
      handler: 'start_pipeline.lambda_handler',
      environment: {
        ...commonLambdaProps.environment,
        STATE_MACHINE_ARN: stateMachineArn,
      },
    });

    const getProjectFn = new lambda.Function(this, 'GetProjectFn', {
      ...commonLambdaProps,
      handler: 'get_project.lambda_handler',
      environment: {
        ...commonLambdaProps.environment,
        STATE_MACHINE_ARN: stateMachineArn,
      },
    });

    const getStagesFn = new lambda.Function(this, 'GetStagesFn', {
      ...commonLambdaProps,
      handler: 'get_stages.lambda_handler',
    });

    const getArtifactFn = new lambda.Function(this, 'GetArtifactFn', {
      ...commonLambdaProps,
      handler: 'get_artifact.lambda_handler',
    });

    const planFn = new lambda.Function(this, 'PlanFn', {
      ...commonLambdaProps,
      handler: 'plan.lambda_handler',
      environment: {
        ...commonLambdaProps.environment,
        PLANNER_FUNCTION_NAME: props.plannerFunctionName,
      },
    });

    const listProjectsFn = new lambda.Function(this, 'ListProjectsFn', {
      ...commonLambdaProps,
      handler: 'list_projects.lambda_handler',
    });

    // IAM permissions
    table.grantReadWriteData(createProjectFn);
    table.grantReadWriteData(startPipelineFn);
    table.grantReadWriteData(getProjectFn);
    table.grantReadWriteData(getStagesFn);
    table.grantReadWriteData(getArtifactFn);

    bucket.grantRead(getArtifactFn);

    const sfnPolicy = new iam.PolicyStatement({
      actions: ['states:StartExecution', 'states:DescribeExecution'],
      resources: [
        stateMachineArn,
        `arn:aws:states:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:execution:sdlc-pipeline:*`,
      ],
    });

    startPipelineFn.addToRolePolicy(sfnPolicy);
    getProjectFn.addToRolePolicy(sfnPolicy);

    // Plan function needs to invoke the planner Lambda
    planFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [`arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${props.plannerFunctionName}`],
      })
    );

    // List projects just needs table read
    table.grantReadData(listProjectsFn);

    const jwtAuthorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${props.userPoolId}`,
      {
        jwtAudience: [props.userPoolClientId],
      },
    );

    // API Gateway HTTP API
    this.api = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'sdlc-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['*'],
      },
    });

    // Routes
    this.api.addRoutes({
      path: '/projects',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'CreateProjectIntegration',
        createProjectFn,
      ),
      authorizer: jwtAuthorizer,
    });

    this.api.addRoutes({
      path: '/projects/{project_id}/run',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'StartPipelineIntegration',
        startPipelineFn,
      ),
      authorizer: jwtAuthorizer,
    });

    this.api.addRoutes({
      path: '/projects/{project_id}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'GetProjectIntegration',
        getProjectFn,
      ),
      authorizer: jwtAuthorizer,
    });

    this.api.addRoutes({
      path: '/projects/{project_id}/stages',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'GetStagesIntegration',
        getStagesFn,
      ),
      authorizer: jwtAuthorizer,
    });

    this.api.addRoutes({
      path: '/artifacts/{proxy+}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'GetArtifactIntegration',
        getArtifactFn,
      ),
      authorizer: jwtAuthorizer,
    });

    this.api.addRoutes({
      path: '/plan',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'PlanIntegration',
        planFn,
      ),
      authorizer: jwtAuthorizer,
    });

    this.api.addRoutes({
      path: '/projects',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'ListProjectsIntegration',
        listProjectsFn,
      ),
      authorizer: jwtAuthorizer,
    });

    this.apiUrl = this.api.url!;
  }
}
