FROM node:18

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

RUN npx nx build taskos

CMD [ "node", "dist/packages/taskos/main.js" ]
