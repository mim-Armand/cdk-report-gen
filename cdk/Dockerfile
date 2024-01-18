FROM public.ecr.aws/lambda/nodejs:20 as builder

# LABEL maintainer="mim Armand"

# Copy package.json and source file
COPY package*.json index.ts ${LAMBDA_TASK_ROOT}
WORKDIR ${LAMBDA_TASK_ROOT}

# Install dependancies and build the project
RUN npm install
RUN npm run build

# COPY --from=builder /usr/app/dist/* ./

CMD ["index.allHandlers"]


# * `docker build --platform linux/amd64 -t docker-image:report-poc .`  build the docker image
# * `docker run --platform linux/amd64 -p 9000:8080 docker-image:report-poc -v` Test the image locally
# * `docker run -p 9000:8080  docker-image:report-poc` # <-- this one works better when run from M1 mac
# * `curl "http://localhost:9000/2015-03-31/functions/function/invocations" -d '{}'`
# * `curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" -d '{}'`