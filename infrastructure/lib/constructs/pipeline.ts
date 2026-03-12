import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PipelineConstructProps {
  table: dynamodb.Table;
  bucket: s3.Bucket;
}

export class PipelineConstruct extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  public readonly agentFunctions: Record<string, lambda.Function>;

  constructor(scope: Construct, id: string, props: PipelineConstructProps) {
    super(scope, id);

    const bedrockModelId = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';

    // Common Lambda props
    const commonLambdaProps: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        ARTIFACTS_BUCKET: props.bucket.bucketName,
        PROJECTS_TABLE: props.table.tableName,
        BEDROCK_MODEL_ID: bedrockModelId,
        BEDROCK_REGION: cdk.Aws.REGION,
      },
    };

    // Create agent Lambda functions
    const agentNames = [
      'requirements_agent',
      'codegen_agent',
      'testgen_agent',
      'security_agent',
      'codereview_agent',
      'documentation_agent',
    ];

    this.agentFunctions = {};

    for (const agentName of agentNames) {
      const fn = new lambda.Function(this, `${agentName}-fn`, {
        ...commonLambdaProps,
        functionName: `sdlc-${agentName.replace(/_/g, '-')}`,
        handler: 'handler.lambda_handler',
        code: lambda.Code.fromAsset(
          path.join(__dirname, `../../../backend/agents/${agentName}/package`)
        ),
        // Security agent needs more memory for bandit
        ...(agentName === 'security_agent' ? { memorySize: 1024 } : {}),
      } as lambda.FunctionProps);

      // Grant permissions
      props.table.grantReadWriteData(fn);
      props.bucket.grantReadWrite(fn);
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel'],
          resources: [
            'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
            `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:inference-profile/us.anthropic.claude-*`,
          ],
        })
      );

      this.agentFunctions[agentName] = fn;
    }

    // ─── Step Functions State Machine ───────────────────────────────

    // 1. InitializePipeline — set iteration to 0 and initialize stages
    const initializePipeline = new sfn.Pass(this, 'InitializePipeline', {
      result: sfn.Result.fromObject({
        iteration: 0,
        stages: {
          codegen: null,
          codereview: null,
        },
      }),
      resultPath: '$.init',
    });

    // After init, restructure state so iteration and stages are at top level
    const restructureState = new sfn.Pass(this, 'RestructureState', {
      parameters: {
        'project_id.$': '$.project_id',
        'project_context.$': '$.project_context',
        'iteration.$': '$.init.iteration',
        'stages.$': '$.init.stages',
      },
    });

    // Requirements task — result goes to $.stages.requirements
    const requirements = new tasks.LambdaInvoke(this, 'RequirementsAgent', {
      lambdaFunction: this.agentFunctions['requirements_agent'],
      payload: sfn.TaskInput.fromObject({
        'project_id.$': '$.project_id',
        'execution_id.$': '$$.Execution.Id',
        'iteration.$': '$.iteration',
        'project_context.$': '$.project_context',
        'previous_stages': {},
      }),
      resultSelector: {
        'stage.$': '$.Payload.stage',
        'status.$': '$.Payload.status',
        's3_key.$': '$.Payload.s3_key',
        'summary.$': '$.Payload.summary',
        'iteration.$': '$.Payload.iteration',
        'metadata.$': '$.Payload.metadata',
      },
      resultPath: '$.stages.requirements',
      retryOnServiceExceptions: true,
    });

    // Code Generation task — result goes to $.stages.codegen
    const codeGeneration = new tasks.LambdaInvoke(this, 'CodeGenerationAgent', {
      lambdaFunction: this.agentFunctions['codegen_agent'],
      payload: sfn.TaskInput.fromObject({
        'project_id.$': '$.project_id',
        'execution_id.$': '$$.Execution.Id',
        'iteration.$': '$.iteration',
        'project_context.$': '$.project_context',
        'previous_stages': {
          'requirements.$': '$.stages.requirements',
          'codegen.$': '$.stages.codegen',
          'codereview.$': '$.stages.codereview',
        },
      }),
      resultSelector: {
        'stage.$': '$.Payload.stage',
        'status.$': '$.Payload.status',
        's3_key.$': '$.Payload.s3_key',
        'summary.$': '$.Payload.summary',
        'iteration.$': '$.Payload.iteration',
        'metadata.$': '$.Payload.metadata',
      },
      resultPath: '$.stages.codegen',
      retryOnServiceExceptions: true,
    });

    // Test Generation task (runs in parallel branch)
    const testGeneration = new tasks.LambdaInvoke(this, 'TestGenerationAgent', {
      lambdaFunction: this.agentFunctions['testgen_agent'],
      payload: sfn.TaskInput.fromObject({
        'project_id.$': '$.project_id',
        'execution_id.$': '$$.Execution.Id',
        'iteration.$': '$.iteration',
        'project_context.$': '$.project_context',
        'previous_stages': {
          'requirements.$': '$.stages.requirements',
          'codegen.$': '$.stages.codegen',
        },
      }),
      resultSelector: {
        'stage.$': '$.Payload.stage',
        'status.$': '$.Payload.status',
        's3_key.$': '$.Payload.s3_key',
        'summary.$': '$.Payload.summary',
        'iteration.$': '$.Payload.iteration',
        'metadata.$': '$.Payload.metadata',
      },
      retryOnServiceExceptions: true,
    });

    // Security Scan task (runs in parallel branch)
    const securityScan = new tasks.LambdaInvoke(this, 'SecurityScanAgent', {
      lambdaFunction: this.agentFunctions['security_agent'],
      payload: sfn.TaskInput.fromObject({
        'project_id.$': '$.project_id',
        'execution_id.$': '$$.Execution.Id',
        'iteration.$': '$.iteration',
        'project_context.$': '$.project_context',
        'previous_stages': {
          'codegen.$': '$.stages.codegen',
        },
      }),
      resultSelector: {
        'stage.$': '$.Payload.stage',
        'status.$': '$.Payload.status',
        's3_key.$': '$.Payload.s3_key',
        'summary.$': '$.Payload.summary',
        'iteration.$': '$.Payload.iteration',
        'metadata.$': '$.Payload.metadata',
      },
      retryOnServiceExceptions: true,
    });

    // Parallel: TestGen + Security
    const parallelAnalysis = new sfn.Parallel(this, 'ParallelAnalysis', {
      resultPath: '$.stages.parallel',
    });
    parallelAnalysis.branch(testGeneration);
    parallelAnalysis.branch(securityScan);

    // Code Review task
    const codeReview = new tasks.LambdaInvoke(this, 'CodeReviewAgent', {
      lambdaFunction: this.agentFunctions['codereview_agent'],
      payload: sfn.TaskInput.fromObject({
        'project_id.$': '$.project_id',
        'execution_id.$': '$$.Execution.Id',
        'iteration.$': '$.iteration',
        'project_context.$': '$.project_context',
        'previous_stages': {
          'requirements.$': '$.stages.requirements',
          'codegen.$': '$.stages.codegen',
          'testgen.$': '$.stages.parallel[0]',
          'security.$': '$.stages.parallel[1]',
        },
      }),
      resultSelector: {
        'stage.$': '$.Payload.stage',
        'status.$': '$.Payload.status',
        's3_key.$': '$.Payload.s3_key',
        'summary.$': '$.Payload.summary',
        'iteration.$': '$.Payload.iteration',
        'verdict.$': '$.Payload.verdict',
        'metadata.$': '$.Payload.metadata',
      },
      resultPath: '$.stages.codereview',
      retryOnServiceExceptions: true,
    });

    // EvaluateReview — Choice state
    const evaluateReview = new sfn.Choice(this, 'EvaluateReview');

    // IncrementIteration — increment iteration counter and loop back
    // Using a Pass state with intrinsic function States.MathAdd
    const incrementIteration = new sfn.Pass(this, 'IncrementIteration', {
      parameters: {
        'project_id.$': '$.project_id',
        'project_context.$': '$.project_context',
        'stages.$': '$.stages',
        'iteration.$': 'States.MathAdd($.iteration, 1)',
      },
    });

    // Documentation task
    const documentation = new tasks.LambdaInvoke(this, 'DocumentationAgent', {
      lambdaFunction: this.agentFunctions['documentation_agent'],
      payload: sfn.TaskInput.fromObject({
        'project_id.$': '$.project_id',
        'execution_id.$': '$$.Execution.Id',
        'iteration.$': '$.iteration',
        'project_context.$': '$.project_context',
        'previous_stages': {
          'requirements.$': '$.stages.requirements',
          'codegen.$': '$.stages.codegen',
          'testgen.$': '$.stages.parallel[0]',
          'security.$': '$.stages.parallel[1]',
          'codereview.$': '$.stages.codereview',
        },
      }),
      resultSelector: {
        'stage.$': '$.Payload.stage',
        'status.$': '$.Payload.status',
        's3_key.$': '$.Payload.s3_key',
        'summary.$': '$.Payload.summary',
        'iteration.$': '$.Payload.iteration',
        'metadata.$': '$.Payload.metadata',
      },
      resultPath: '$.stages.documentation',
      retryOnServiceExceptions: true,
    });

    // Terminal states
    const pipelineSucceeded = new sfn.Succeed(this, 'PipelineSucceeded');
    const pipelineFailed = new sfn.Fail(this, 'PipelineFailed', {
      error: 'PipelineExecutionFailed',
      cause: 'One or more pipeline stages failed',
    });

    // Wire up error handling
    requirements.addCatch(pipelineFailed, { resultPath: '$.error' });
    codeGeneration.addCatch(pipelineFailed, { resultPath: '$.error' });
    parallelAnalysis.addCatch(pipelineFailed, { resultPath: '$.error' });
    codeReview.addCatch(pipelineFailed, { resultPath: '$.error' });
    documentation.addCatch(pipelineFailed, { resultPath: '$.error' });

    // Wire up the feedback loop
    evaluateReview
      .when(
        sfn.Condition.and(
          sfn.Condition.stringEquals('$.stages.codereview.verdict', 'CHANGES_REQUESTED'),
          sfn.Condition.numberLessThan('$.iteration', 2)
        ),
        incrementIteration
      )
      .otherwise(documentation);

    // IncrementIteration loops back to CodeGeneration
    incrementIteration.next(codeGeneration);

    // Documentation leads to success
    documentation.next(pipelineSucceeded);

    // Chain: Init → Restructure → Requirements → CodeGen → Parallel → Review → Evaluate
    const definition = initializePipeline
      .next(restructureState)
      .next(requirements)
      .next(codeGeneration)
      .next(parallelAnalysis)
      .next(codeReview)
      .next(evaluateReview);

    // Create the state machine
    this.stateMachine = new sfn.StateMachine(this, 'SdlcPipeline', {
      stateMachineName: 'sdlc-pipeline',
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(1),
    });

    // Output
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      description: 'Step Functions state machine ARN',
    });
  }
}
