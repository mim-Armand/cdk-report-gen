FROM public.ecr.aws/lambda/nodejs:20 as builder

# LABEL maintainer="mim Armand"


COPY package.json index.ts ${LAMBDA_TASK_ROOT}
WORKDIR ${LAMBDA_TASK_ROOT}
RUN npm install
RUN npm run build

# COPY --from=builder /usr/app/dist/* ./
CMD ["index.allHandlers"]

# * `docker build --platform linux/amd64 -t docker-image:report-poc .`  build the docker image
# * `docker run --platform linux/amd64 -p 9000:8080 docker-image:report-poc` Test the image locally
# * `curl "http://localhost:9000/2015-03-31/functions/function/invocations" -d '{}'`