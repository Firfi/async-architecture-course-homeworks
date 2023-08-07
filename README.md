[hw0](docs/homework0/homework0.md)

[hw1](docs/homework1/README.md)

Run docker-compose. 

Run `npx nx serve inventory` to start inventory service // TODO dependency build instructions

No env needed. 

Ports needed on host machine: 3000, 3001, 8000

Go to http://localhost:8000/admin , un / pass: admin@popug.io / admin@popug.io

add some users

goto `http://localhost:3001/protected` and log in i.e. with `admin@popug.io / admin@popug.io`

set `fief_session=YOUR_FIEF_SESSION_COOKIE_FROM_BROWSER; Path=/; Expires=Tue, 06 Aug 2024 08:04:49 GMT;` cookie in postman

`GET` http://localhost:3001/protected in Postman to check; should be 200. 

add/edit a user in http://localhost:8000/admin/users/

`POST` i.e. /create with body {"description": "123"} (and type json) to check creation works


