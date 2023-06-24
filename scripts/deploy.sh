#!/bin/bash

TOPIC_NAME=lighthouse-runner-topic
FUNCTION_NAME=logPubSubUrl
PROJECT=lighthouse-scheduling-demo

gcloud functions deploy $FUNCTION_NAME \
  --runtime=nodejs18 \
  --trigger-topic=$TOPIC_NAME \
  --entry-point=$FUNCTION_NAME \
  --memory=2048 \
  --project=$PROJECT \
  --source=dist/
