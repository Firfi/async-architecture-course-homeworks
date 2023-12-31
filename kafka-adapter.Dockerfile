# Use an official Node.js runtime as the base image
FROM node:18

# Set the working directory in the Docker image
WORKDIR /usr/src/app

# Copy package.json and package-lock.json into the Docker image
COPY package*.json ./

# Install the application dependencies
RUN npm install

# Copy the application files into the Docker image
COPY . .

RUN npx nx build auth-kafka-adapter

# Make port 3000 available outside the Docker image
EXPOSE 3000

# Start the application
CMD [ "node", "dist/packages/auth-kafka-adapter/main.js" ]
