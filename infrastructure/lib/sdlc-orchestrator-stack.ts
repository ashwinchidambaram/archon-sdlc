import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageConstruct } from './constructs/storage';
import { PipelineConstruct } from './constructs/pipeline';
import { ApiConstruct } from './constructs/api';
import { AuthConstruct } from './constructs/auth';
import { FrontendConstruct } from './constructs/frontend';

export class SdlcOrchestratorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Storage: DynamoDB + S3
    const storage = new StorageConstruct(this, 'Storage');

    // Pipeline: Agent Lambdas + Step Functions state machine
    const pipeline = new PipelineConstruct(this, 'Pipeline', {
      table: storage.table,
      bucket: storage.bucket,
    });

    // Auth: Cognito User Pool
    const auth = new AuthConstruct(this, 'Auth');

    // API: API Gateway + handler Lambdas
    const api = new ApiConstruct(this, 'Api', {
      table: storage.table,
      bucket: storage.bucket,
      stateMachineArn: pipeline.stateMachine.stateMachineArn,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
    });

    // Frontend: S3 + CloudFront static site
    const frontend = new FrontendConstruct(this, 'Frontend', {
      apiUrl: api.apiUrl,
    });

    // Stack outputs (keys must match what deploy.sh expects)
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.apiUrl,
      description: 'API Gateway endpoint URL',
    });
    new cdk.CfnOutput(this, 'AppUrl', {
      value: `https://${frontend.distribution.distributionDomainName}`,
      description: 'CloudFront app URL',
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: auth.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: auth.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });
  }
}
